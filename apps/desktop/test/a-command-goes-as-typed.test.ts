import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import {
  A_PERSON_SENT_IT,
  messageNamingItsSender,
  theDirectionLine,
  THE_PERSON_AT_A_WINDOW,
  type TurnOrigin,
} from '../src/main/runtime/turn-origin'
import { theOwnerOf } from '../src/shared/piece-called'
import {
  aCommandTakesNoAttachments,
  aPersonsCommand,
  LOOKS_LIKE_A_COMMAND,
  mightBeAPersonsCommand,
  theCommandItNames,
} from '../src/main/runtime/a-command-goes-as-typed'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  agentName,
  type HandedPath,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * 🔴 **708 · `R42` — a person's command goes to the provider exactly as typed.**
 *
 * ⛔ **The defect, `704` §4**: since `607` the host framed every message a person typed, so the
 * Claude CLI received *"Sent by a person, typed into this app. … /compact"* and ran nothing — a
 * slash command is a command only at the START of the input. The ruling is in
 * `a-command-goes-as-typed.ts`, whole.
 *
 * ⚑ **What the provider HEARD is read off the double's echo**, the exact string that crossed
 * `handle.send` — so a frame, a direction line, a task line or an attachment block in front of or
 * behind the command is visible here, and every arm pins the WHOLE string.
 *
 * ⚑ **Every arm has its control, one fact over** (`R42`'s own list): a person's ordinary message is
 * still framed; an agent's `/clear` is still framed; a `/word` the provider did not publish is still
 * framed once the list is known; and a path is never a command.
 *
 * ⚠️ **What this cannot say**: whether the CLI then RAN the command. That is the provider's half and
 * it is measured where it can be — `probe:claude-command-as-typed` (the CLI, bare vs framed, stamped
 * vs not) and `smoke:ui` steps 62 and 70 (the CLI's own transcript, through the app).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * ⚑ **The one await between the gate and the handover, given a hook** — so the race the handover's
 * own refusal exists for can be put on the path deterministically (`put-the-hazard-on-the-path`).
 * ⚠️ A no-op unless a test sets it, and reset after every test.
 */
const between = vi.hoisted(() => ({ theGateAndTheHandover: async (): Promise<void> => {} }))
vi.mock('../src/main/runtime/handed-path', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/runtime/handed-path')>()
  return {
    ...original,
    recheckHandedPaths: async (...args: Parameters<typeof original.recheckHandedPaths>) => {
      await between.theGateAndTheHandover()
      return await original.recheckHandedPaths(...args)
    },
  }
})

class RecordingSink implements RuntimeEventSink {
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

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

describe('708 · R42 — a person’s command goes to the provider exactly as typed', () => {
  let handles: FakeSessionHandle[]
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-708-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-708-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚑ Short, so the arm whose provider never answers ends in this test's time and not in five
      // seconds — the bound is what is under test there, not its length.
      commandListWaitMs: 60,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
  })

  afterEach(async () => {
    between.theGateAndTheHandover = async () => {}
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** ⚑ What the PROVIDER received — the double's echo, the exact string that crossed `send`. */
  const providerHeard = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'assistant_message' }> =>
          event.type === 'assistant_message',
      )
      .map((event) => event.text.replace(/^echo: /, ''))

  /** ⚑ The double a conversation runs on — launch order is id order, one launch per id here. */
  const handleOf = (sessionId: string): FakeSessionHandle => {
    const index = Number(sessionId.replace('sess_', '')) - 1
    const handle = handles[index]
    if (handle === undefined) throw new Error(`no handle for ${sessionId}`)
    return handle
  }

  const pendingCardOn = (sessionId: string): string | null => {
    const answered = new Set(
      ledger(sessionId).flatMap((event) =>
        event.type === 'user_decision' ? [event.requestId] : [],
      ),
    )
    const open = ledger(sessionId).flatMap((event) =>
      event.type === 'permission_request' && !answered.has(event.id) ? [event.id] : [],
    )
    return open.at(-1) ?? null
  }

  /** ⛔ Answer whatever a conversation is parked on until `until` holds — `413`'s helper. */
  const unblockUntil = async (sessionId: string, until: () => boolean, what: string) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (until()) return
      const card = pendingCardOn(sessionId)
      if (card !== null) {
        try {
          await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
        } catch {
          host.claimSession(sessionId, window)
          await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
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

  /**
   * ⚑ **A project manager and the worker it gave a piece to** — `607`'s pair: the one relationship
   * in which an agent may put words into another conversation. ⚠️ Its own identities, so no launch
   * order but this one's is involved — {@link handleOf} is not used on these.
   *
   * ⚑ **D-016** — `spawn_agent` is gone: the pm gives the worker a piece, and the brief is the
   * worker's first turn, so it is let be heard before a case counts what the worker heard.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    tools: AgentToolset
  }> => {
    const workerProfile = 'worker-708'
    const opened = await host.createSession(
      { provider: 'claude', profileId: workerProfile, approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(opened.sessionId, window)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm-708', approvalMode: 'auto', cwd: root },
      window,
    )
    const tools = agentToolsFor(host, pm)
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await unblockUntil(
      worker,
      () => providerHeard(worker).length > 0,
      'the worker to hear its brief',
    )
    return { pm, worker, tools }
  }

  /** What the provider heard LAST — a spawned worker has heard its purpose first. */
  const lastHeard = (sessionId: string): string => providerHeard(sessionId).at(-1) ?? ''

  /** A person opens a conversation in `auto`, so each turn ends on its own. */
  const personOpens = async (
    provider: Provider = 'claude',
    approvalMode: 'auto' | 'ask' = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession({ provider, approvalMode, cwd: root }, window)
    return sessionId
  }

  const attachment = async (): Promise<HandedPath> => {
    const path = join(root, 'notes.md')
    writeFileSync(path, 'notes\n')
    const chosen = await classifyHandedPath(path, root)
    if (!('handed' in chosen)) throw new Error(chosen.refusal)
    return chosen.handed
  }

  const framedAsAPersons = (heard: string | undefined): boolean =>
    heard?.startsWith(A_PERSON_SENT_IT) === true

  /**
   * ⚑ **D-016 · commit 7 · R3 — the direction line that answers the pm**, addressed by the piece it
   * owns where it spelled the pm's id — composed from the product's own parts, never typed.
   */
  const answeringThePm = (pm: string): string => {
    const named = store.workThatNames(pm)
    if (named === null) throw new Error('the pm holds no piece, so no piece addresses it')
    // ⚑ W4.187 · the direction line names the sender by its name alone: the sender line named it in full.
    return theDirectionLine(
      `${agentName('pm-708', store.agentIdentities())}, ${theOwnerOf(named)}`,
      'caller',
    )
  }

  describe('§1 · the composer — `send`', () => {
    it('🔴 a person’s published command reaches the provider bare — and their own stamp rides it', async () => {
      const id = await personOpens()
      await host.send(id, '/compact', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear the command')
      expect(providerHeard(id)).toEqual(['/compact'])
      // ⚑ **`662`'s field still says who**, beside the words rather than in them.
      expect(handleOf(id).origins).toEqual([{ kind: 'person' }])
      // ⚑ …and the ledger still records the person's turn, as they typed it.
      const turns = ledger(id).filter((event) => event.type === 'user_turn')
      expect(turns.map((event) => (event.type === 'user_turn' ? event.text : ''))).toEqual([
        '/compact',
      ])
    })

    it('⚑ the control: a person’s ordinary message is still framed', async () => {
      const id = await personOpens()
      await host.send(id, 'what are you doing?', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
      expect(
        withoutWhatThisAppAdds(providerHeard(id)[0] ?? '').endsWith('\n\nwhat are you doing?'),
      ).toBe(true)
    })

    it('⚑ the whole text goes, arguments and leading space included — the CLI trims, this does not', async () => {
      const id = await personOpens()
      await host.send(id, '  /compact keep the test plan', window)
      await host.send(id, '/cost', window)
      await waitFor(() => providerHeard(id).length === 2, 'the provider to hear both')
      // ⚠️ `/cost` is an ALIAS of `/usage` — the CLI resolves aliases, so the decision does too.
      expect(providerHeard(id)).toEqual(['  /compact keep the test plan', '/cost'])
    })

    it('⛔ once the list is known, a `/word` the provider did not publish keeps the frame', async () => {
      const id = await personOpens()
      await host.send(id, '/frobnicate now', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
    })

    it('⛔ a path is never a command — its first word carries a second slash', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = 'refuses'
      await host.send(id, '/Users/me/notes.md is broken', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
      expect(handleOf(id).commandsAsked, 'the premise: the list could not be had').toBe(1)
    })

    it('🔴 an MCP prompt, published as `server:prompt (MCP)` and typed that way, goes bare (708 review)', async () => {
      // ⚑ The CLI publishes an MCP prompt under its user-facing name — `srv:review (MCP)` — and
      // joins a typed ` (MCP)` back onto the first word (`Rv`), so that is the name looked up.
      const id = await personOpens()
      handleOf(id).commandsAnswer = { prefix: '/', commands: [{ name: 'srv:review (MCP)' }] }
      await host.send(id, '/srv:review (MCP) file.ts', window)
      // ⚠️ The control, one fact over: the same name WITHOUT the marker is not what was published.
      await host.send(id, '/srv:review file.ts', window)
      await waitFor(() => providerHeard(id).length === 2, 'the provider to hear both')
      expect(providerHeard(id)[0]).toBe('/srv:review (MCP) file.ts')
      expect(framedAsAPersons(providerHeard(id)[1])).toBe(true)
    })

    it('🔴 a plugin’s sub-command typed with a space — the CLI retries `name:first` — goes bare (708 review)', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = { prefix: '/', commands: [{ name: 'myplugin:review' }] }
      await host.send(id, '/myplugin review this change', window)
      // ⚠️ The control, one fact over: a sub-command the plugin does not have.
      await host.send(id, '/myplugin rewrite this change', window)
      await waitFor(() => providerHeard(id).length === 2, 'the provider to hear both')
      expect(providerHeard(id)[0]).toBe('/myplugin review this change')
      expect(framedAsAPersons(providerHeard(id)[1])).toBe(true)
    })

    it('🔴 a list cut short cannot vouch for what it dropped — a missing name that looks like a command goes bare', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = { prefix: '/', commands: [{ name: 'compact' }], dropped: 3 }
      await host.send(id, '/deploy-docs now', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(providerHeard(id)).toEqual(['/deploy-docs now'])
    })

    it('⚑ …and the control: the SAME list, complete, frames the missing name', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = { prefix: '/', commands: [{ name: 'compact' }] }
      await host.send(id, '/deploy-docs now', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
    })
  })

  describe('§2 · the list — held, asked for, or not to be had', () => {
    it('⚑ a list the provider already published is read without asking', async () => {
      const id = await personOpens()
      handleOf(id).simulateProviderCommands()
      await waitFor(
        () => ledger(id).some((event) => event.type === 'provider_commands'),
        'the published list to be recorded',
      )
      await host.send(id, '/compact', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(providerHeard(id)).toEqual(['/compact'])
      expect(handleOf(id).commandsAsked).toBe(0)
    })

    it('⚑ with none published, the provider is asked ONCE and its answer is held', async () => {
      const id = await personOpens()
      await host.send(id, '/compact', window)
      await host.send(id, '/frobnicate', window)
      await waitFor(() => providerHeard(id).length === 2, 'the provider to hear both')
      expect(handleOf(id).commandsAsked).toBe(1)
      expect(providerHeard(id)[0]).toBe('/compact')
      expect(framedAsAPersons(providerHeard(id)[1])).toBe(true)
      // ⚑ One ask, one published answer — the double publishes as the adapters do; that the Claude
      // adapter does is `claude-provider-commands-ask.test.ts`'s.
      expect(ledger(id).filter((event) => event.type === 'provider_commands')).toHaveLength(1)
    })

    it('⛔ an ordinary message never asks — the provider is asked only when the answer can matter', async () => {
      const id = await personOpens()
      await host.send(id, 'hello', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(handleOf(id).commandsAsked).toBe(0)
    })

    it('🔴 a provider that cannot say: a message shaped like a command goes as typed (R42)', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = 'refuses'
      await host.send(id, '/frobnicate', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(providerHeard(id)).toEqual(['/frobnicate'])
      expect(handleOf(id).commandsAsked, 'the premise: it was asked, and could not say').toBe(1)
    })

    it('🔴 a provider that never answers: the wait is BOUNDED, and then the same rule', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = 'never-answers'
      const began = Date.now()
      await host.send(id, '/compact', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear it')
      expect(providerHeard(id)).toEqual(['/compact'])
      // ⚠️ A bound, not a length: the host's own deadline ended the wait (60 ms here).
      expect(Date.now() - began).toBeLessThan(3_000)
      expect(handleOf(id).commandsAsked, 'the premise: it was asked').toBe(1)
    })

    it('⚑ a provider that has not answered is asked ONCE while that ask is pending — commands join it', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = 'never-answers'
      await host.send(id, '/compact', window)
      await host.send(id, '/frobnicate', window)
      await waitFor(() => providerHeard(id).length === 2, 'the provider to hear both')
      expect(handleOf(id).commandsAsked).toBe(1)
      // ⚑ …and a list it publishes afterwards still wins, because a held list is read first.
      handleOf(id).simulateProviderCommands({ commands: [{ name: 'compact' }] })
      await waitFor(
        () => ledger(id).some((event) => event.type === 'provider_commands'),
        'the late list to be recorded',
      )
      await host.send(id, '/frobnicate', window)
      await waitFor(() => providerHeard(id).length === 3, 'the provider to hear the third')
      expect(framedAsAPersons(providerHeard(id)[2])).toBe(true)
      expect(handleOf(id).commandsAsked).toBe(1)
    })

    it('⚑ an ask that FAILED is forgotten — the next command asks again, and an answer is then held', async () => {
      // ⚠️ 708's second review: latching the failure judged a provider slow to start by shape for the
      // rest of its life. A refusal now clears the ask.
      const id = await personOpens()
      const double = handleOf(id)
      double.commandsAnswer = 'refuses'
      await host.send(id, '/frobnicate', window)
      await waitFor(() => providerHeard(id).length === 1, 'the provider to hear the first')
      expect(providerHeard(id)[0]).toBe('/frobnicate')
      double.commandsAnswer = { prefix: '/', commands: [{ name: 'compact' }] }
      await host.send(id, '/frobnicate', window)
      await host.send(id, '/frobnicate', window)
      await waitFor(() => providerHeard(id).length === 3, 'the provider to hear all three')
      // ⚑ Asked again after the failure, and not a third time: the answer is held.
      expect(double.commandsAsked).toBe(2)
      expect(framedAsAPersons(providerHeard(id)[1])).toBe(true)
      expect(framedAsAPersons(providerHeard(id)[2])).toBe(true)
    })
  })

  describe('§3 · every other path a person’s words take', () => {
    it('🔴 a command QUEUED behind a running turn goes bare when it is flushed', async () => {
      const id = await personOpens('claude', 'ask')
      await host.send(id, 'first', window)
      // ⚑ An `ask` turn holds on its card — the running turn the command waits behind.
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      expect((await host.queueMessage(id, '/compact', window)).outcome).toBe('queued')
      const card = ledger(id).find((event) => event.type === 'permission_request')
      if (card?.type !== 'permission_request') throw new Error('no card')
      await host.respondPermission(id, card.id, { outcome: 'allow' }, window)
      await waitFor(() => providerHeard(id).length === 2, 'the flush to reach the provider')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
      expect(providerHeard(id)[1]).toBe('/compact')
    })

    it('🔴 interrupt-and-send’s replacement goes bare', async () => {
      const id = await personOpens('claude', 'ask')
      await host.send(id, 'first', window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      await host.sendInterrupting(id, '/compact', window)
      await waitFor(() => providerHeard(id).length === 2, 'the replacement to reach the provider')
      expect(providerHeard(id)[1]).toBe('/compact')
    })

    it('⛔ an AGENT’s `/clear` is framed — an agent never clears another conversation by message', async () => {
      const made = await aPmAndItsWorker()
      // ⚑ The worker's provider PUBLISHES `/clear` — as Claude's handshake does — and both arms below
      // are decided against that held list, so the ONE fact between them is who sent it.
      const worker = handles.at(-1)
      if (worker === undefined) throw new Error('no worker double')
      worker.simulateProviderCommands({ commands: [{ name: 'clear' }] })
      await waitFor(
        () => ledger(made.worker).some((event) => event.type === 'provider_commands'),
        'the worker’s list to be recorded',
      )
      const before = providerHeard(made.worker).length
      const sent = await callOn(made.tools, 'message_agent', {
        kind: 'note',
        agent: made.worker,
        text: '/clear',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await unblockUntil(
        made.worker,
        () => providerHeard(made.worker).length > before,
        'the worker to hear it',
      )
      const heard = lastHeard(made.worker)
      // ⚑ D-011 — named, with its conversation's address in the direction line: ⚑ D-016 · commit
      // 7 · R3 — the piece it owns.
      expect(heard.startsWith('Sent by ') && heard.includes(answeringThePm(made.pm)), heard).toBe(
        true,
      )
      expect(heard).toContain('/clear')
      expect(heard).not.toBe('/clear')
      // ⚑ …and the control, on the SAME worker: a person's `/clear` there goes bare.
      host.claimSession(made.worker, window)
      await host.send(made.worker, '/clear', window)
      await unblockUntil(
        made.worker,
        () => providerHeard(made.worker).length > before + 1,
        'the person’s command to go',
      )
      expect(lastHeard(made.worker)).toBe('/clear')
      expect(worker.commandsAsked, 'the held list was read — nothing was asked').toBe(0)
    })
  })

  describe('§4 · a command with attachments is refused at the door, and says so', () => {
    it('🔴 refused BEFORE anything is sent, with the sentence — and the control sends', async () => {
      const id = await personOpens()
      const file = await attachment()
      await expect(host.send(id, '/compact', window, [file])).rejects.toThrow(
        aCommandTakesNoAttachments('/compact', true),
      )
      expect(providerHeard(id)).toEqual([])
      expect(ledger(id).some((event) => event.type === 'user_turn')).toBe(false)
      // ⚑ The control, one fact over: the same file on an ordinary message goes, framed.
      await host.send(id, 'read this', window, [file])
      await waitFor(() => providerHeard(id).length === 1, 'the ordinary message to go')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
      expect(providerHeard(id)[0]).toContain('notes.md')
    })

    it('🔴 refused at the QUEUE, while the composer still holds the files', async () => {
      const id = await personOpens('claude', 'ask')
      await host.send(id, 'first', window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      await expect(host.queueMessage(id, '/compact', window, [await attachment()])).rejects.toThrow(
        aCommandTakesNoAttachments('/compact', true),
      )
      expect(ledger(id).some((event) => event.type === 'message_queued')).toBe(false)
    })

    it('🔴 a held message that BECAME a command before its flush is ended with the sentence — never retried forever', async () => {
      const id = await personOpens('claude', 'ask')
      await host.send(id, 'first', window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      // ⚑ At the queue, the list the host is told has no `/frobnicate`: an ordinary message, file
      // and all, which the queue accepts.
      const queued = await host.queueMessage(id, '/frobnicate', window, [await attachment()])
      expect(queued.outcome).toBe('queued')
      // ⚠️ …and then the provider's list moves (`commands_changed`), so at the flush it IS one.
      handleOf(id).simulateProviderCommands({ commands: [{ name: 'frobnicate' }] })
      await waitFor(
        () => ledger(id).filter((event) => event.type === 'provider_commands').length === 2,
        'the moved list to be recorded',
      )
      const card = ledger(id).find((event) => event.type === 'permission_request')
      if (card?.type !== 'permission_request') throw new Error('no card')
      await host.respondPermission(id, card.id, { outcome: 'allow' }, window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'message_unqueued'),
        'the held message to end',
      )
      const ended = ledger(id).find((event) => event.type === 'message_unqueued')
      expect(ended).toMatchObject({
        reason: 'abandoned',
        detail: aCommandTakesNoAttachments('/frobnicate', true),
      })
      // ⛔ **Exactly ONE ending** (`234` §1), still one after a settle — an ending that did not take the
      // message would flush it again and again, each time ending it anew.
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(ledger(id).filter((event) => event.type === 'message_unqueued')).toHaveLength(1)
      // ⛔ Nothing reached the provider but the first turn — the command did not go, with or without
      // its block — and it is not waiting for another boundary.
      expect(providerHeard(id)).toHaveLength(1)
      expect(ledger(id).filter((event) => event.type === 'user_turn')).toHaveLength(1)
    })

    it('🔴 a list that moves between the gate and the handover never sends the command without its files', async () => {
      // ⚑ The race the handover's own refusal is for: the gate asks and is told `[]`, so `/frobnicate`
      // is an ordinary message and its file is accepted; the provider then publishes a list that HAS
      // it, and that list lands while the send awaits its file check. ⛔ Without the handover's
      // refusal the command would go bare and the file would be dropped, with nobody told.
      const id = await personOpens()
      const double = handleOf(id)
      double.commandsAnswer = { prefix: '/', commands: [] }
      const file = await attachment()
      let gatePassed = false
      between.theGateAndTheHandover = async () => {
        // ⚠️ The premise, asserted where it holds: the gate asked, was told `[]`, and let it through.
        gatePassed = double.commandsAsked === 1
        const lists = (): number =>
          ledger(id).filter((event) => event.type === 'provider_commands').length
        const before = lists()
        double.simulateProviderCommands({ commands: [{ name: 'frobnicate' }] })
        await waitFor(() => lists() > before, 'the moved list to be recorded')
      }
      await expect(host.send(id, '/frobnicate', window, [file])).rejects.toThrow(
        aCommandTakesNoAttachments('/frobnicate', true),
      )
      expect(gatePassed, 'the gate refused it — this arm measures nothing').toBe(true)
      expect(providerHeard(id)).toEqual([])
      expect(ledger(id).some((event) => event.type === 'user_turn')).toBe(false)
    })

    it('🔴 refused BEFORE the interrupt — the running turn is not stopped for it', async () => {
      const id = await personOpens('claude', 'ask')
      await host.send(id, 'first', window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      const held = handleOf(id).status()
      expect(held, 'the turn is not held on its card — this arm measures nothing').toBe(
        'waiting_permission',
      )
      await expect(
        host.sendInterrupting(id, '/compact', window, [await attachment()]),
      ).rejects.toThrow(aCommandTakesNoAttachments('/compact', true))
      expect(handleOf(id).status()).toBe(held)
      expect(
        ledger(id).some((event) => event.type === 'turn' && event.state === 'interrupted'),
      ).toBe(false)
    })

    it('🔴 713 · `708` H-4 — a list that moves after the first gate cannot refuse AFTER the stop', async () => {
      // ⚑ The first gate asks and is told the FAKE list, which has no `frobnicate`: an ordinary
      // message, its file accepted. ⚠️ Then — after that gate, just above the interrupt (the hook is
      // the first path check, the one await there) — the provider publishes a list that HAS it; the
      // second gate, after the stop, is where a moved list used to be asked. ⛔ Before 713 the SECOND gate, after the running turn was
      // stopped, asked the moved list and refused: a turn destroyed for words that never went.
      const id = await personOpens('claude', 'ask')
      const double = handleOf(id)
      await host.send(id, 'first', window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      const file = await attachment()
      let moved = false
      between.theGateAndTheHandover = async () => {
        if (moved) return
        moved = true
        const lists = (): number =>
          ledger(id).filter((event) => event.type === 'provider_commands').length
        const before = lists()
        double.simulateProviderCommands({ commands: [{ name: 'frobnicate' }] })
        await waitFor(() => lists() > before, 'the moved list to be recorded')
      }
      await host.sendInterrupting(id, '/frobnicate now', window, [file])
      await waitFor(() => providerHeard(id).length === 2, 'the replacement to reach the provider')
      expect(moved, 'the list never moved — this arm measures nothing').toBe(true)
      expect(
        ledger(id).some((event) => event.type === 'turn' && event.state === 'interrupted'),
      ).toBe(true)
      // ⚑ The FIRST gate's answer went through: an ordinary message, framed, its file with it.
      const replacement = providerHeard(id)[1] ?? ''
      expect(framedAsAPersons(replacement), replacement).toBe(true)
      expect(replacement).toContain('/frobnicate now')
      expect(replacement).toContain(JSON.stringify(file.path))
    })

    it('🔴 713 · `708` H-4 — …and the other way round: a command the first gate let through goes bare after the stop', async () => {
      // ⚑ The first gate asks and is told the FAKE list, which HAS `compact`. ⚠️ Then the list moves
      // to one without it. ⛔ Before 713 the handover asked the moved list and framed the words the
      // first gate had judged a command — one send, two answers about what it was.
      const id = await personOpens('claude', 'ask')
      const double = handleOf(id)
      await host.send(id, 'first', window)
      await waitFor(
        () => ledger(id).some((event) => event.type === 'permission_request'),
        'the first turn to hold on its card',
      )
      let moved = false
      between.theGateAndTheHandover = async () => {
        if (moved) return
        moved = true
        const lists = (): number =>
          ledger(id).filter((event) => event.type === 'provider_commands').length
        const before = lists()
        double.simulateProviderCommands({ commands: [{ name: 'review' }] })
        await waitFor(() => lists() > before, 'the moved list to be recorded')
      }
      await host.sendInterrupting(id, '/compact', window)
      await waitFor(() => providerHeard(id).length === 2, 'the replacement to reach the provider')
      expect(moved, 'the list never moved — this arm measures nothing').toBe(true)
      expect(providerHeard(id)[1]).toBe('/compact')
    })

    it('⛔ the gate is a PERSON’s: an agent’s `/compact` is never looked up, and goes framed', async () => {
      const made = await aPmAndItsWorker()
      const worker = handles.at(-1)
      if (worker === undefined) throw new Error('no worker double')
      const before = providerHeard(made.worker).length
      // ⚠️ `message_agent` carries no files, so this cannot show a refusal withheld — it shows the gate
      // never ASKED on an agent's behalf: the cheap half's person clause, at the host.
      const sent = await callOn(made.tools, 'message_agent', {
        kind: 'note',
        agent: made.worker,
        text: '/compact',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await unblockUntil(
        made.worker,
        () => providerHeard(made.worker).length > before,
        'the worker to hear it',
      )
      expect(lastHeard(made.worker).startsWith('Sent by ')).toBe(true)
      expect(lastHeard(made.worker)).toContain(answeringThePm(made.pm))
      expect(worker.commandsAsked, 'the gate asked on an agent’s behalf').toBe(0)
    })

    it('⚑ a list cut short: the refusal says the command only READS as one — and never that no list came', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = { prefix: '/', commands: [{ name: 'compact' }], dropped: 4 }
      const refusal = host.send(id, '/deploy-docs', window, [await attachment()])
      await expect(refusal).rejects.toThrow(aCommandTakesNoAttachments('/deploy-docs', false))
      await expect(refusal).rejects.not.toThrow('could not be had')
      expect(providerHeard(id)).toEqual([])
    })

    it('⚑ with no list to be had, the sentence says the command only READS as one', async () => {
      const id = await personOpens()
      handleOf(id).commandsAnswer = 'refuses'
      await expect(host.send(id, '/etc', window, [await attachment()])).rejects.toThrow(
        aCommandTakesNoAttachments('/etc', false),
      )
      expect(providerHeard(id)).toEqual([])
    })
  })

  // ⚠️ **713 · `/compact` left this section.** A person's `/compact` on Codex runs Codex's own
  // compaction since `R59` — `compact-on-both-providers.test.ts`, over the real adapter. ⚑ What
  // stays here is `R42`'s half, which did not move: no `/` word is one of Codex's commands, so R42
  // never sends one bare there. These doubles have no compaction door, so the word is `/review`.
  describe('§5 · Codex — no `/` commands on its protocol, so R42 keeps the frame', () => {
    it('⛔ a person’s `/review` on Codex is framed, and Codex is never asked', async () => {
      const id = await personOpens('codex')
      await host.send(id, '/review', window)
      await waitFor(() => providerHeard(id).length === 1, 'Codex to hear it')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
      expect(handleOf(id).commandsAsked).toBe(0)
    })

    it('⛔ …and with its `$` list HELD, even one naming `review`, the frame stays', async () => {
      // ⚑ Codex publishes at thread start, so a held `$` list is the ordinary state; a `/` word is
      // never one of its rows, whatever the row is called.
      const id = await personOpens('codex')
      handleOf(id).simulateProviderCommands(
        { commands: [{ name: 'review' }] },
        'fake/thread/start',
        '$',
      )
      await waitFor(
        () => ledger(id).some((event) => event.type === 'provider_commands'),
        'Codex’s list to be recorded',
      )
      await host.send(id, '/review', window)
      await waitFor(() => providerHeard(id).length === 1, 'Codex to hear it')
      expect(framedAsAPersons(providerHeard(id)[0])).toBe(true)
    })
  })
})

describe('708 · the rule itself — `a-command-goes-as-typed.ts`, with nothing around it', () => {
  const PUBLISHED = {
    prefix: '/',
    commands: [{ name: 'compact' }, { name: 'usage', aliases: ['cost'] }, { name: 'code-review' }],
  }
  const AN_AGENT: TurnOrigin = {
    who: 'a-caller-with-an-id',
    caller: 'sess_pm',
    profile: 'pm',
    aPersonIsBehindIt: true,
  }

  it('⚑ the first word is read the way the CLI reads it — trimmed, then the slash, to the first space', () => {
    const nameOf = (text: string): string | null => theCommandItNames(text)?.name ?? null
    expect(nameOf('/compact')).toBe('compact')
    expect(nameOf('  /compact keep the plan')).toBe('compact')
    expect(nameOf('/code-review\n--fix')).toBe('code-review')
    expect(nameOf('/')).toBeNull()
    expect(nameOf('/ compact')).toBeNull()
    expect(nameOf('please /compact')).toBeNull()
  })

  it('⚑ …and joins the CLI’s ` (MCP)` marker back on, exactly when the CLI does', () => {
    expect(theCommandItNames('/srv:p (MCP)')).toEqual({
      name: 'srv:p (MCP)',
      base: 'srv:p',
      sub: null,
    })
    expect(theCommandItNames('/srv:p (MCP) file.ts')).toEqual({
      name: 'srv:p (MCP)',
      base: 'srv:p',
      sub: null,
    })
    // ⛔ One fact over: the marker glued to more text is an argument, not the marker.
    expect(theCommandItNames('/srv:p (MCP)x')).toEqual({
      name: 'srv:p',
      base: 'srv:p',
      sub: '(MCP)x',
    })
    expect(theCommandItNames('/srv:p file (MCP)')).toEqual({
      name: 'srv:p',
      base: 'srv:p',
      sub: 'file',
    })
  })

  it('⛔ the shape is the CLI’s own command-name rule — a path is never one', () => {
    // ⚑ The pattern spelled out, and examples of what it takes and what it refuses.
    expect(LOOKS_LIKE_A_COMMAND.source).toBe('^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$')
    expect(LOOKS_LIKE_A_COMMAND.test('compact')).toBe(true)
    expect(LOOKS_LIKE_A_COMMAND.test('plugin:thing')).toBe(true)
    expect(LOOKS_LIKE_A_COMMAND.test('Users/me/notes.md')).toBe(false)
    expect(LOOKS_LIKE_A_COMMAND.test('notes.md')).toBe(false)
  })

  it('🔴 a person + a published name (or alias) → the command; each fact one over → null', () => {
    const person = THE_PERSON_AT_A_WINDOW
    expect(aPersonsCommand('/compact', person, PUBLISHED, '/')).toEqual({
      word: '/compact',
      listed: true,
    })
    expect(aPersonsCommand('/cost', person, PUBLISHED, '/')).toEqual({
      word: '/cost',
      listed: true,
    })
    // ⛔ one fact over, each: an agent, the app, an unpublished name, a `$` list, not a slash.
    expect(aPersonsCommand('/compact', AN_AGENT, PUBLISHED, '/')).toBeNull()
    expect(aPersonsCommand('/compact', null, PUBLISHED, '/')).toBeNull()
    expect(aPersonsCommand('/frobnicate', person, PUBLISHED, '/')).toBeNull()
    expect(
      aPersonsCommand('/compact', person, { prefix: '$', commands: [{ name: 'compact' }] }, '$'),
    ).toBeNull()
    expect(aPersonsCommand('compact', person, PUBLISHED, '/')).toBeNull()
  })

  it('🔴 no list to be had → shaped like a command goes as typed, but only where commands are `/`', () => {
    const person = THE_PERSON_AT_A_WINDOW
    expect(aPersonsCommand('/frobnicate', person, null, '/')).toEqual({
      word: '/frobnicate',
      listed: false,
    })
    expect(aPersonsCommand('/Users/me/notes.md', person, null, '/')).toBeNull()
    // ⛔ Codex: its prefix is `$`, so a `/` word is never its command, list or no list.
    expect(aPersonsCommand('/compact', person, null, '$')).toBeNull()
    expect(aPersonsCommand('/compact', AN_AGENT, null, '/')).toBeNull()
  })

  it('🔴 a list cut short answers only for what it carried — a missing, command-shaped name is judged by shape', () => {
    const person = THE_PERSON_AT_A_WINDOW
    const cut = { ...PUBLISHED, dropped: 2 }
    expect(aPersonsCommand('/deploy-docs', person, cut, '/')).toEqual({
      word: '/deploy-docs',
      listed: false,
    })
    expect(aPersonsCommand('/compact', person, cut, '/')).toEqual({
      word: '/compact',
      listed: true,
    })
    // ⛔ one fact over: the complete list, and a path on the cut one.
    expect(aPersonsCommand('/deploy-docs', person, PUBLISHED, '/')).toBeNull()
    expect(aPersonsCommand('/Users/me', person, cut, '/')).toBeNull()
    expect(aPersonsCommand('/deploy-docs', AN_AGENT, cut, '/')).toBeNull()
  })

  it('⚑ the cheap half asks nothing it does not need to', () => {
    expect(mightBeAPersonsCommand('/compact', THE_PERSON_AT_A_WINDOW, '/')).toBe(true)
    expect(mightBeAPersonsCommand('/compact', AN_AGENT, '/')).toBe(false)
    expect(mightBeAPersonsCommand('/compact', THE_PERSON_AT_A_WINDOW, '$')).toBe(false)
    expect(mightBeAPersonsCommand('hello', THE_PERSON_AT_A_WINDOW, '/')).toBe(false)
    expect(mightBeAPersonsCommand('/compact', null, '/')).toBe(false)
  })

  it('⚑ the sentence names the command, says what to do, and ends on the fact they need', () => {
    const said = aCommandTakesNoAttachments('/compact', true)
    expect(said.startsWith('/compact is a command')).toBe(true)
    expect(said).toContain('takes no attachments')
    expect(said).toContain('remove them to run it')
    expect(said.endsWith('Nothing has been sent.')).toBe(true)
    // ⛔ …and it claims only what was known: a word judged by its shape merely READS as one.
    const judged = aCommandTakesNoAttachments('/etc', false)
    expect(judged.startsWith('/etc reads as a command')).toBe(true)
    expect(judged).not.toContain('/etc is a command')
    expect(judged.endsWith('Nothing has been sent.')).toBe(true)
  })

  it('⛔ the probes send the PRODUCT’s frame — their copy is the bytes `messageNamingItsSender` writes', () => {
    // ⚑ `probe:claude-command-as-typed` and `probe:codex-command-as-typed` cannot import this app,
    // so they hold a copy; a copy that drifted would measure a frame the product no longer sends.
    const source = readFileSync(
      join(here, '../../../packages/runtime/smoke/command-as-typed-evidence.ts'),
      'utf8',
    )
    const literal = /export const A_PERSONS_FRAME =\s*'((?:[^'\\]|\\.)*)'/.exec(source)?.[1]
    expect(literal, 'A_PERSONS_FRAME was renamed or is no longer one literal').toBeDefined()
    const copy = JSON.parse(`"${(literal ?? '').replaceAll('"', '\\"')}"`) as string
    expect(copy).toBe(messageNamingItsSender('', THE_PERSON_AT_A_WINDOW))
  })
})
