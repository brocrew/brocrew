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
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { theDirectionLine } from '../src/main/runtime/turn-origin'
import {
  agentName,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-011 · every message says who sent it and how they relate (proposal §8)
 *
 * ⛔ An agent's words reached the receiving model under *"Sent by `sess_4f…`, running as profile
 * `web-pm`"*, and the receiver had to match the id against its launch line to learn whether this
 * was its giver. ⚑ Now: *"Sent by Sam (web-pm), who gave you W1.2"*, or *"…, another agent; it
 * gave you no work"*. The person's line, the stamp and the command exception (R42) are unchanged
 * and pinned in their own files. ⚑ **D-016 · a piece reads by its label**, and the giver's words
 * that hand one over are the give's brief — the receiver's first turn — where they were a `work`
 * message to a conversation a spawn had started idle.
 *
 * ⚑ Real host, real SQLite ledger, real toolsets; the only double is the provider, whose echo is
 * the exact string that crossed `SessionHandle.send`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('D-011 · the sender says where it stands', () => {
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

  /** ⚑ Every toolset a launch was handed, in order. */
  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly order: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.order.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let order: AgentToolset[]
  let counter: number
  let window: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d011-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d011-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    order = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, order, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<{ id: string; tools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    const tools = order.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ What the PROVIDER was handed, turn by turn — the double's echo of it. */
  const heard = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ')
        ? [event.text.slice('echo: '.length)]
        : [],
    )

  /** ⚑ The turn that carried these words, as the provider was handed it. */
  const theTurnCarrying = async (sessionId: string, words: string): Promise<string> => {
    await waitFor(() => heard(sessionId).some((one) => one.includes(words)), `"${words}"`)
    return heard(sessionId).find((one) => one.includes(words)) ?? ''
  }

  const cards = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  /** ⚑ Let the turn parked on its card finish, so what is held behind it goes. */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    await waitFor(() => cards(sessionId).length > 0, 'a card to answer')
    host.claimSession(sessionId, window)
    await host.respondPermission(
      sessionId,
      cards(sessionId).at(-1) as string,
      { outcome: 'allow' },
      window,
    )
  }

  /**
   * ⚑ A PM a person opened, the worker it gave a piece to, and a peer that never gave that worker
   * work. ⚑ **D-016 · the give starts the worker, and its brief — `build it` — is the worker's first
   * turn**, parked on the Fake's card (the PM is in `ask`, and a give runs in its giver's mode).
   */
  const aPmItsWorkerAndAPeer = async () => {
    await host.close((await personOpens('worker')).id, window)
    const pm = await personOpens('pm')
    const given = await callOn(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Build the index',
      brief: 'build it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = order.at(-1) as AgentToolset
    const peer = await personOpens('reviewer')
    return {
      pm,
      worker,
      workerTools,
      peer,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  const nameOf = (profile: string): string => agentName(profile, store.agentIdentities())

  /**
   * ⚑ **The tag's own sentence**, the first of the line. ⚠️ A person opened these senders, so `439`'s
   * clause follows it (*"A person is at that conversation…"*) — pinned in its own file, not here.
   */
  const theTagIn = (turn: string): string =>
    (turn.split('\n')[0] ?? '').split('. A person')[0] + '.'

  it('🔴 the giver, handing over work: by name, and "who is giving you" the piece, by its label and title', async () => {
    const { pm, worker, label } = await aPmItsWorkerAndAPeer()
    const turn = await theTurnCarrying(worker, 'build it')
    const direction = turn.split('\n\n')[1]
    expect(theTagIn(turn)).toBe(
      `Sent by ${nameOf('pm')} (pm), who is giving you ${label} · Build the index.`,
    )
    // ⚑ The address is still there, in the direction line — ⚑ D-016 · commit 7 · R3: the piece the
    // giver owns, the root the given piece hangs under, where it was the giver's id.
    const owns = store.workThatNames(pm.id)
    expect(owns).toEqual({ label: store.rootOf(pm.id)?.label, title: null, definitionOfDone: null })
    expect(label.startsWith(`${String(owns?.label)}.`), label).toBe(true)
    // ⚑ W4.178 · a brief, so the line says nothing of a note: its piece line asks for an answer.
    expect(direction).toBe(
      theDirectionLine(`${nameOf('pm')}, the owner of ${String(owns?.label)}`, 'caller', true),
    )
    expect(direction).not.toContain('A note expects no answer')
    expect(turn).toContain('Finish it by calling reply_to_parent')
    // ⛔ …and never the old spellings: neither the profile sentence nor the giver's id.
    expect(turn).not.toContain('running as profile')
    expect(turn).not.toContain(`\`${pm.id}\``)
  })

  it('🔴 the giver, following up while that work is open: "who gave you W<n>.1", and the message is about that piece', async () => {
    const { pm, worker, label } = await aPmItsWorkerAndAPeer()
    await theTurnCarrying(worker, 'build it')
    await letTheTurnFinish(worker)
    // ⚑ **D-016 · a follow-up names the piece it follows up.**
    await callOn(pm.tools, 'message_agent', {
      kind: 'follow-up',
      agent: worker,
      piece: label,
      text: 'and the tests',
    })
    const turn = await theTurnCarrying(worker, 'and the tests')
    expect(theTagIn(turn)).toBe(`Sent by ${nameOf('pm')} (pm), who gave you ${label}.`)
    // 🔴 **F088 · and the line says so, last**, by its label and title — open, so with no word on
    // how it ended.
    const about = `only an approval needs the person directly. This message is about ${label} · Build the index.`
    expect((turn.split('\n')[0] ?? '').slice(-about.length)).toBe(about)
  })

  it('🔴 another agent that gave it no work: "another agent; it gave you no work"', async () => {
    const { worker, peer } = await aPmItsWorkerAndAPeer()
    // ⚑ The brief's turn ends first, so the note goes straight out rather than behind it.
    await theTurnCarrying(worker, 'build it')
    await letTheTurnFinish(worker)
    await callOn(peer.tools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'fyi: main moved',
    })
    const turn = await theTurnCarrying(worker, 'fyi: main moved')
    expect(theTagIn(turn)).toBe(
      `Sent by ${nameOf('reviewer')} (reviewer), another agent; it gave you no work.`,
    )
  })

  it('🔴 worked out when the words GO: a follow-up held while its work was open goes out after the work closed', async () => {
    const { pm, worker, workerTools, piece, label } = await aPmItsWorkerAndAPeer()
    await theTurnCarrying(worker, 'build it')
    // ⚑ Held behind the worker's turn, while the work is open…
    const held = await callOn(pm.tools, 'message_agent', {
      kind: 'follow-up',
      agent: worker,
      piece: label,
      text: 'how is it going?',
    })
    expect(held.delivery).toBe('queued')
    // ⚑ …and the work is answered before the held words go.
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece,
      outcome: 'done',
      summary: 'built',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await letTheTurnFinish(worker)
    const turn = await theTurnCarrying(worker, 'how is it going?')
    // ⛔ Not *"who gave you W<n>.1"*, which was true when the words were queued and is not now.
    expect(theTagIn(turn)).toBe(
      `Sent by ${nameOf('pm')} (pm), who gave you work that is now closed.`,
    )
    // 🔴 **F088 · and the piece it is about, marked as it stands when the words GO** — answered,
    // which it was not when they were held.
    const about = `only an approval needs the person directly. This message is about ${label} · Build the index (answered).`
    expect((turn.split('\n')[0] ?? '').slice(-about.length)).toBe(about)
  })
})
