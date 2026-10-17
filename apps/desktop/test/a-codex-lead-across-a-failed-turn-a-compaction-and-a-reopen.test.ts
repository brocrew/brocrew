import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CodexRuntime,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import type { WindowReadQuery, WindowReadResult } from '../src/main/db/window-read-protocol'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import {
  LEADS_OPEN_WITH,
  leadRowsFrom,
  theLeadOwed,
  WHAT_CHANGED_HEADER,
  whatTheThreadHolds,
} from '../src/main/runtime/codex-lead'
import { profileBundleSpans, thisConversationSpans } from '../src/main/runtime/factory-text'
import {
  conversationBlock,
  readSessionInstructions,
  THIS_CONVERSATION_HEADER,
} from '../src/main/runtime/instructions'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  readSavedMethods,
  savedMethodsLinesOf,
  savedMethodsUseOf,
  withTheLinesSent,
} from '../src/main/saved-methods'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'
import type {
  LaunchedEvent,
  RuntimeEventMessage,
  SessionInstructions,
  TranscriptEvent,
  UserTurnEvent,
} from '../src/shared/runtime-ipc'
import { THE_MODEL_LIST } from './lib/scripted-codex-host'

/**
 * # adc4232b · a Codex thread carries BroBot's lead once, then only what changed — over the host
 *
 * The record's read is pinned on its own in `what-a-codex-thread-holds-read-from-its-record.test.ts`.
 * This file pins the host's half: what it WRITES for that read, and what it sends a life after it.
 * The devs' tests run on `FakeRuntime`, which cannot fail a turn as this app's word, and none of them
 * reopens a thread after a failed turn or a compaction; the one that reads `user_turn.lead` reads a
 * reopen that owed what changed, and nothing after it.
 *
 *  - §1 · 🔴 after a reopen that owed only what changed, a turn this app failed owes the WHOLE again
 *    (D-039, `firstTurnLeadIs = 'whole'`), and the next message's row says `whole` — so a later
 *    reopen does not read a whole lead as a partial one. ⚑ The reopen's own first message said
 *    `what-changed`.
 *  - §2 · 🔴 a reopen reads the record end to end, through the store's own query: ⛔ a life whose
 *    only lead went with a turn this app failed, or whose history a `/compact` rewrote, leaves the
 *    thread holding none, so the reopen sends the whole. ⚑ The same life with its turn completed and
 *    no compaction does not.
 *  - §3 · ⛔ a lead that does not open with this conversation's line is not recorded as one
 *    (`sent.startsWith(LEADS_OPEN_WITH)`). ⚑ The product's own lead is, with its length.
 *
 * ⚑ A real host on a real SQLite ledger over the REAL `CodexRuntime`, its app-server scripted from
 * the shapes the adapter reads (copied from `the-tools-reach-codex-in-its-lead-…test.ts`, with a
 * thread id per conversation so a reopen resumes its own), and `main/index.ts`'s instruction wiring
 * (copied from `what-this-agent-was-given.test.ts`). ⛔ Every folder is a `mkdtemp` one, removed
 * after; the reader is handed `home: userData`, so nothing reads a real home.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** An async queue the scripted app-server pushes into. */
class Wire<T> implements AsyncIterable<T> {
  private readonly waiting: T[] = []
  private settle: ((result: IteratorResult<T>) => void) | null = null
  private closed = false
  push(item: T): void {
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: item, done: false })
      return
    }
    this.waiting.push(item)
  }
  close(): void {
    this.closed = true
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: undefined as never, done: true })
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.waiting.length > 0) {
          return Promise.resolve({ value: this.waiting.shift() as T, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.settle = resolve
        })
      },
    }
  }
}

/** Every scripted app-server this file made, so a test can read what each was sent. */
const madeTransports: ScriptedCodex[] = []
/** Each conversation whose leads the window's reader was asked for, in order. */
const leadsAsked: string[] = []

/** What the scripted app-server does next, shared by every transport so a test moves one fact. */
interface Script {
  /** How many of the next `turn/start` requests the app-server refuses outright. */
  rejectTurnStarts: number
  /** Whether a turn reflects its input back as a `userMessage` item, as the app-server does. */
  echoInput?: boolean
}

/**
 * ⚑ **The app-server, scripted from what the adapter reads** — the D-039 file's, with one change: a
 * thread id of its own per `thread/start`, and on `thread/resume` the one it was asked for, so two
 * conversations of one app never share a provider id and a reopen's handshake names its own thread.
 */
class ScriptedCodex implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turns = 0
  private thread: string
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  constructor(
    readonly home: string,
    private readonly script: Script,
    thread: string,
  ) {
    this.thread = thread
    madeTransports.push(this)
  }
  request(method: string, params?: unknown): Promise<unknown> {
    const given = (params ?? {}) as Record<string, unknown>
    this.requests.push({ method, params: given })
    if (method === 'model/list') return Promise.resolve(THE_MODEL_LIST)
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.home,
      })
    }
    if (method === 'thread/start' || method === 'thread/resume') {
      const asked = given['threadId']
      if (method === 'thread/resume' && typeof asked === 'string') this.thread = asked
      const cwd = typeof given['cwd'] === 'string' ? given['cwd'] : '/tmp/x'
      // ⚑ A conformant app-server applies the profile it was asked for — `auto` is `never` with no
      // sandbox — and the adapter fails a handshake that echoes anything else (013).
      const unattended = given['approvalPolicy'] === 'never'
      return Promise.resolve(
        threadStartResponse(
          this.thread,
          cwd,
          unattended ? { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } } : {},
        ) as unknown as Record<string, unknown>,
      )
    }
    if (method === 'turn/start') {
      if (this.script.rejectTurnStarts > 0) {
        this.script.rejectTurnStarts--
        return Promise.reject(new Error('the app-server could not begin the turn'))
      }
      const id = `tn_${String(++this.turns)}`
      const input = given['input']
      setTimeout(() => this.anOrdinaryTurn(id, this.script.echoInput === true ? input : null), 0)
      return Promise.resolve(turnStartResponse(id))
    }
    if (method === 'thread/compact/start') {
      const id = `tc_${String(++this.turns)}`
      setTimeout(() => this.aCompaction(id), 0)
      return Promise.resolve({})
    }
    return Promise.resolve({})
  }
  private push(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  private anOrdinaryTurn(id: string, input: unknown): void {
    this.push('turn/started', turnStartedNotification(this.thread, id))
    if (input !== null) {
      // With a copy of its input as a JSON string, as a payload may carry what it was sent.
      const item = {
        type: 'userMessage',
        id: `u_${id}`,
        clientId: null,
        content: input,
        asJson: JSON.stringify(input),
      }
      this.push('item/started', { threadId: this.thread, turnId: id, item, startedAtMs: 1 })
      this.push('item/completed', { threadId: this.thread, turnId: id, item, completedAtMs: 1 })
      // …and the same text in a provider error and an MCP server's diagnostic, which are kept too.
      const said = JSON.stringify(input)
      this.push('error', {
        error: { message: `fictional failure while reading ${said}` },
        willRetry: false,
        threadId: this.thread,
        turnId: id,
      })
      this.push('mcpServer/event/stream/notification', {
        server: 'fictional-server',
        event: { diagnostic: `fictional diagnostic: ${said}` },
      })
    }
    this.push('item/completed', {
      threadId: this.thread,
      turnId: id,
      item: { type: 'agentMessage', id: `m_${id}`, text: 'ok' },
      completedAtMs: 1,
    })
    this.push('turn/completed', turnCompletedNotification(this.thread, completedTurn(id)))
  }
  private aCompaction(id: string): void {
    this.push('turn/started', turnStartedNotification(this.thread, id))
    const item = { type: 'contextCompaction', id: `cc_${id}` }
    this.push('item/started', { threadId: this.thread, turnId: id, item, startedAtMs: 1 })
    this.push('item/completed', { threadId: this.thread, turnId: id, item, completedAtMs: 2 })
    this.push('turn/completed', turnCompletedNotification(this.thread, completedTurn(id)))
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  exited: Promise<void> | undefined
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

type HostOptions = ConstructorParameters<typeof RuntimeHost>[0]
type Reader = NonNullable<HostOptions['readInstructions']>

/** A lead that does not open with this conversation's line — the D-039 file's reader. */
const OWED = 'OWED LEAD'

const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}

const owesALead: Reader = () => ({
  instructions: NOTHING_INJECTED,
  systemHint: undefined,
  memoryLoaded: null,
  firstTurnLead: OWED,
})

describe('adc4232b · the lead a Codex thread holds, over the host', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let script: Script
  let threads: number

  beforeEach(() => {
    script = { rejectTurnStarts: 0 }
    threads = 0
    leadsAsked.length = 0
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  interface App {
    host: RuntimeHost
    store: SessionStore
    window: RecordingSink
    root: string
    userData: string
  }

  /**
   * ⚑ One app: its own store and folders, Codex on the scripted app-server, and `main/index.ts`'s own
   * instruction wiring — unless a test hands it another reader.
   */
  /**
   * How the window's reader answers a reopen's leads read: with the store's own rows at once, after
   * a delay, never, or with a failure. Absent: there is no window reader, and the host reads the
   * store itself.
   */
  type LeadsAnswer = 'at-once' | 'never' | 'fails' | { readonly afterMs: number }

  const anApp = (reader?: Reader, leads?: LeadsAnswer): App => {
    const userData = mkdtempSync(join(tmpdir(), 'brobot2-w4205-lead-'))
    const root = mkdtempSync(join(tmpdir(), 'brobot2-w4205-lead-root-'))
    const db: AppDatabase = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ensureWorkspace(userData)
    const store = createSessionStore(db)
    let counter = 0
    const theProductsReader: Reader = (provider, cwd, providerHome, context) => {
      const composed = profileBundleSpans(context)
      const bundle = publishProfileBundle(provider, providerHome, composed.text)
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome,
        bundle,
        bundleComposed: composed,
        thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
        workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
        workspaceOwnFiles: workspaceOwnFilesIn(userData),
        home: userData,
      })
      return {
        instructions: read.instructions,
        systemHint: read.systemHint ?? undefined,
        ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
        memoryLoaded: read.memoryLoaded,
        profileFile: read.profileFile,
      }
    }
    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        if (provider !== 'codex') throw new Error(`this rig opens Codex only, not ${provider}`)
        return new CodexRuntime(
          (launch: CodexLaunchContext) =>
            new ScriptedCodex(launch.providerHome, script, `th_${String(++threads)}`),
        )
      },
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      commandListWaitMs: 60,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
      readInstructions: reader ?? theProductsReader,
      reopenLeadsGraceMs: 60,
      ...(leads === undefined
        ? {}
        : {
            limitsWriterStamp: limitsWriterSampler(db, () => true),
            windowReader: {
              read: (query: WindowReadQuery): Promise<WindowReadResult> => {
                if (query.kind !== 'leads') return Promise.reject(new Error('not this rig'))
                const rows = (): WindowReadResult => ({
                  kind: 'leads',
                  rows: store.threadLeadRows!(
                    query.sessionId,
                    query.opening,
                    query.before,
                    query.historicalOpening,
                  ),
                })
                leadsAsked.push(query.sessionId)
                if (leads === 'never') return new Promise<WindowReadResult>(() => {})
                if (leads === 'fails') return Promise.reject(new Error('fictional worker failure'))
                if (leads === 'at-once') return Promise.resolve(rows())
                return new Promise((resolve) => setTimeout(() => resolve(rows()), leads.afterMs))
              },
              close: async () => {},
            },
          }),
    })
    cleanup.push(async () => {
      await host.closeAll()
      db.close()
      for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
    })
    return { host, store, window: new RecordingSink('webContents:1'), root, userData }
  }

  const ledger = (app: App, id: string): TranscriptEvent[] =>
    app.store.events(id).map((entry) => entry.event)

  const turnRows = (app: App, id: string) =>
    ledger(app, id).flatMap((event) => (event.type === 'turn' ? [event] : []))

  /** A Codex conversation a person opened, in `profileId`. */
  const aCodexConversation = async (app: App, profileId = 'ali'): Promise<string> => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', profileId, approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    return sessionId
  }

  /** A person sends one message, and the conversation ends one more turn of any word. */
  const saying = async (app: App, id: string, words: string): Promise<void> => {
    const before = turnRows(app, id).length
    await app.host.send(id, words, app.window)
    await waitFor(() => turnRows(app, id).length === before + 1, `the turn for "${words}"`)
  }

  const isALaunch = (event: TranscriptEvent): event is LaunchedEvent => event.type === 'launched'
  const isAMessage = (event: TranscriptEvent): event is UserTurnEvent => event.type === 'user_turn'

  /** The newest launch of a conversation, with its row's place. */
  const newestLaunch = (app: App, id: string): { ordinal: number; event: LaunchedEvent } => {
    const found = app.store
      .events(id)
      .flatMap(({ ordinal, event }) => (isALaunch(event) ? [{ ordinal, event }] : []))
      .at(-1)
    if (found === undefined) throw new Error(`${id} has no launch`)
    return found
  }

  /** Its message rows after `after`, oldest first, with their places. */
  const messagesAfter = (
    app: App,
    id: string,
    after: number,
  ): { ordinal: number; event: UserTurnEvent }[] =>
    app.store
      .events(id)
      .flatMap(({ ordinal, event }) =>
        isAMessage(event) && ordinal > after ? [{ ordinal, event }] : [],
      )

  /** The whole lead a launch composed: its text for this conversation, under the header. */
  const wholeLeadOf = (launch: { event: LaunchedEvent }): string => {
    const text = launch.event.given?.thisConversation?.text
    if (text === undefined) throw new Error('the launch kept no text for this conversation')
    return conversationBlock(text)
  }

  /** A person closes it and opens it again; the reopen's launch. */
  const reopen = async (app: App, id: string) => {
    await app.host.close(id, app.window)
    await app.host.resumeSession(id, app.window)
    return newestLaunch(app, id)
  }

  // ── §1 ───────────────────────────────────────────────────────────────────

  it('🔴 §1 · ⛔ after a reopen that owed only what changed, a turn this app failed owes the WHOLE again and its row says whole — ⚑ the reopen’s own first message said what-changed', async () => {
    const app = anApp()
    const c1 = await aCodexConversation(app)
    await saying(app, c1, 'one')
    // ⚑ A second conversation of the same profile: c1's next launch lists it, so c1's
    // "This conversation" section changes and the reopen owes only that section.
    await aCodexConversation(app)
    const reopened = await reopen(app, c1)
    const block = wholeLeadOf(reopened)

    script.rejectTurnStarts = 1
    await saying(app, c1, 'two')
    await saying(app, c1, 'three')
    const [two, three] = messagesAfter(app, c1, reopened.ordinal)
    // ⚑ The control: the reopen's first message carried what changed, and said so.
    expect(two?.event.lead?.is).toBe('what-changed')
    expect(two?.event.sent?.startsWith(`${WHAT_CHANGED_HEADER}\n\n`)).toBe(true)
    // Premise: its turn was this app's failure, and it ended after the message's row.
    const failed = turnRows(app, c1).at(-2)
    expect(failed).toMatchObject({ type: 'turn', state: 'failed', wordOf: 'this-app' })
    // ⛔ The next message carries the WHOLE lead — and its row must say `whole`, not the
    // `what-changed` this life started owing, or a later reopen reads the whole as a partial.
    expect(three?.event.sent?.startsWith(`${block}\n\n`)).toBe(true)
    expect(three?.event.lead).toEqual({ is: 'whole', chars: block.length })
  })

  // ── §2 ───────────────────────────────────────────────────────────────────

  it('🔴 §2 · ⛔ a life whose only lead went with a turn this app failed leaves the thread holding none: the reopen sends the whole — ⚑ the same life with its turn completed does not', async () => {
    const failing = anApp()
    const a = await aCodexConversation(failing)
    script.rejectTurnStarts = 1
    await saying(failing, a, 'hello')
    const [first] = messagesAfter(failing, a, -1)
    // Premise: the lead rode the refused message, its row says so, and the failure is this app's
    // word, written after the message's row.
    expect(first?.event.lead?.is).toBe('whole')
    const [refused] = turnRows(failing, a)
    expect(refused).toMatchObject({ type: 'turn', state: 'failed', wordOf: 'this-app' })
    const refusedAt = failing.store.events(a).find((entry) => entry.event.type === 'turn')?.ordinal
    expect(refusedAt).toBeGreaterThan(first?.ordinal ?? Infinity)

    const reopenedA = await reopen(failing, a)
    await saying(failing, a, 'again')
    const [againA] = messagesAfter(failing, a, reopenedA.ordinal)
    const blockA = wholeLeadOf(reopenedA)
    // ⛔ The thread may never have been handed it: the whole goes, said whole.
    expect(againA?.event.sent?.startsWith(`${blockA}\n\n`)).toBe(true)
    expect(againA?.event.lead).toEqual({ is: 'whole', chars: blockA.length })

    // ⚑ The control, one fact over: the turn completed, so the thread holds the lead.
    const completing = anApp()
    const b = await aCodexConversation(completing)
    await saying(completing, b, 'hello')
    expect(turnRows(completing, b)).toMatchObject([{ type: 'turn', state: 'completed' }])
    const reopenedB = await reopen(completing, b)
    await saying(completing, b, 'again')
    const [againB] = messagesAfter(completing, b, reopenedB.ordinal)
    expect(againB?.event.sent).toBeDefined()
    expect(againB?.event.lead?.is).not.toBe('whole')
    expect(againB?.event.sent?.startsWith(`${THIS_CONVERSATION_HEADER}\n\n`)).toBe(false)
  })

  it('🔴 §2 · ⛔ a life whose history a /compact rewrote leaves the thread holding none: the reopen sends the whole — ⚑ the same life with no compaction does not', async () => {
    const compacted = anApp()
    const a = await aCodexConversation(compacted)
    await saying(compacted, a, 'hello')
    await saying(compacted, a, '/compact')
    // Premise: the compaction is on the record, and the lead rode the first message.
    expect(ledger(compacted, a).some((event) => event.type === 'compaction')).toBe(true)
    expect(messagesAfter(compacted, a, -1)[0]?.event.lead?.is).toBe('whole')
    const reopenedA = await reopen(compacted, a)
    await saying(compacted, a, 'again')
    const [againA] = messagesAfter(compacted, a, reopenedA.ordinal)
    const blockA = wholeLeadOf(reopenedA)
    // ⛔ The history the lead rode in was rewritten.
    expect(againA?.event.sent?.startsWith(`${blockA}\n\n`)).toBe(true)
    expect(againA?.event.lead).toEqual({ is: 'whole', chars: blockA.length })

    // ⚑ The control: the same life, no compaction.
    const kept = anApp()
    const b = await aCodexConversation(kept)
    await saying(kept, b, 'hello')
    expect(ledger(kept, b).some((event) => event.type === 'compaction')).toBe(false)
    const reopenedB = await reopen(kept, b)
    await saying(kept, b, 'again')
    const [againB] = messagesAfter(kept, b, reopenedB.ordinal)
    expect(againB?.event.sent).toBeDefined()
    expect(againB?.event.lead?.is).not.toBe('whole')
    expect(againB?.event.sent?.startsWith(`${THIS_CONVERSATION_HEADER}\n\n`)).toBe(false)
  })

  // ── §3 ───────────────────────────────────────────────────────────────────

  it('§3 · ⛔ a lead that does not open with this conversation’s line is not recorded as one — ⚑ the product’s own lead is, with its length', async () => {
    const owing = anApp(owesALead)
    const a = await aCodexConversation(owing)
    await saying(owing, a, 'hello')
    const [row] = messagesAfter(owing, a, -1)
    // Premise: the lead rode in front of the words.
    expect(row?.event.sent?.startsWith(`${OWED}\n\n`)).toBe(true)
    // ⛔ …and the row records none: it is not this conversation's text.
    expect(row?.event.lead).toBeUndefined()

    // ⚑ The control: the product's own reader. Its lead is recorded, whole, at its length.
    const product = anApp()
    const b = await aCodexConversation(product)
    await saying(product, b, 'hello')
    const [own] = messagesAfter(product, b, -1)
    const block = wholeLeadOf(newestLaunch(product, b))
    expect(own?.event.sent?.startsWith(`${block}\n\n`)).toBe(true)
    expect(own?.event.lead).toEqual({ is: 'whole', chars: block.length })
  })

  it.each(['BroBot', 'BroCrew'] as const)(
    'reads a stored %s whole lead through the store, message view and reopen',
    async (name) => {
      const app = anApp()
      const id = await aCodexConversation(app)
      const launch = newestLaunch(app, id)
      const composed = launch.event.given?.thisConversation
      if (composed === undefined || composed === null) throw new Error('no recorded composition')
      const old = `Composed by ${name} for this conversation at this launch:`
      const lead = `${old}\n\n${composed.text}`
      const ordinal = app.store.nextOrdinal(id)
      app.store.append(
        id,
        ordinal,
        {
          type: 'user_turn',
          text: 'before the rename',
          sent: `${lead}\n\nbefore the rename`,
          lead: { is: 'whole', chars: lead.length },
        },
        Date.now(),
      )

      const rows = app.store.threadLeadRows?.(
        id,
        LEADS_OPEN_WITH,
        ordinal + 1,
        'Composed by BroBot for this conversation at this launch',
      )
      if (rows === undefined) throw new Error('no thread reader')
      expect(rows.find((row) => row.ordinal === ordinal)?.sent).toBe(`${lead}\n\nbefore the rename`)
      const held = whatTheThreadHolds(leadRowsFrom(rows), Infinity)
      expect(held.carried).toEqual([{ ordinal, is: 'whole', text: lead, firstOfItsLaunch: true }])
      expect(theLeadOwed(held, composed)).toBeNull()
      expect(
        (await app.host.whatTheModelGot(id, ordinal)).parts.filter(
          (part) => part.kind === 'this-conversation',
        ),
      ).toMatchObject([{ where: 'this-message', text: lead }])

      const reopened = await reopen(app, id)
      await saying(app, id, 'after the rename')
      const [after] = messagesAfter(app, id, reopened.ordinal)
      expect(after?.event.lead?.is).not.toBe('whole')
      expect(
        (await app.host.whatTheModelGot(id, after?.ordinal ?? -1)).parts.filter(
          (part) => part.kind === 'this-conversation',
        )[0],
      ).toMatchObject({ where: 'an-earlier-message', text: lead })
      if (after?.event.lead !== undefined) {
        expect(after.event.lead.is).toBe('what-changed')
        expect(after.event.sent?.startsWith(`${WHAT_CHANGED_HEADER}\n\n`)).toBe(true)
      }
    },
  )

  it.each(['BroBot', 'BroCrew'] as const)(
    'retains a stored %s changed lead beside the earlier whole lead',
    async (name) => {
      const app = anApp()
      const id = await aCodexConversation(app)
      const given = newestLaunch(app, id).event.given
      const composed = given?.thisConversation
      if (given === undefined || composed === undefined || composed === null)
        throw new Error('no recorded composition')
      const whole = `Composed by ${name} for this conversation at this launch:\n\n${composed.text}`
      const firstAt = app.store.nextOrdinal(id)
      app.store.append(
        id,
        firstAt,
        {
          type: 'user_turn',
          text: 'whole',
          sent: `${whole}\n\nwhole`,
          lead: { is: 'whole', chars: whole.length },
        },
        Date.now(),
      )
      const text = composed.text + '\n- A fictional changed section.\n'
      const next = {
        ...composed,
        text,
        sections: composed.sections.map((span, at) =>
          at === composed.sections.length - 1 ? { ...span, end: text.length } : span,
        ),
      }
      app.store.append(
        id,
        app.store.nextOrdinal(id),
        {
          type: 'launched',
          given: { ...given, thisConversation: next },
        },
        Date.now(),
      )
      const last = next.sections.at(-1)
      if (last === undefined) throw new Error('no last section')
      const changed = `Composed by ${name} for this conversation at this launch. These sections replace the ones of the same name you were given earlier in this conversation:\n\n${text.slice(last.start, last.end).trimEnd()}`
      const changedAt = app.store.nextOrdinal(id)
      app.store.append(
        id,
        changedAt,
        {
          type: 'user_turn',
          text: 'changed',
          sent: `${changed}\n\nchanged`,
          lead: { is: 'what-changed', chars: changed.length },
        },
        Date.now(),
      )

      const rows = app.store.threadLeadRows?.(
        id,
        LEADS_OPEN_WITH,
        undefined,
        'Composed by BroBot for this conversation at this launch',
      )
      if (rows === undefined) throw new Error('no thread reader')
      const held = whatTheThreadHolds(leadRowsFrom(rows), Infinity)
      expect(held.carried).toEqual([
        { ordinal: firstAt, is: 'whole', text: whole, firstOfItsLaunch: true },
        { ordinal: changedAt, is: 'what-changed', text: changed, firstOfItsLaunch: true },
      ])
      expect(theLeadOwed(held, next)).toBeNull()
      expect(
        (await app.host.whatTheModelGot(id, changedAt)).parts.filter(
          (part) => part.kind === 'this-conversation',
        ),
      ).toMatchObject([
        { where: 'an-earlier-message', text: whole },
        { where: 'this-message', text: changed },
      ])
      const reopened = await reopen(app, id)
      await saying(app, id, 'after both leads')
      const [after] = messagesAfter(app, id, reopened.ordinal)
      expect(after?.event.lead?.is).toBe('what-changed')
      expect(after?.event.sent?.startsWith(`${WHAT_CHANGED_HEADER}\n\n`)).toBe(true)
      expect(after?.event.sent?.startsWith('Composed by BroBot')).toBe(false)
    },
  )

  it.each(['BroBot', 'BroCrew'] as const)(
    'recognizes a stored %s whole lead without lead metadata',
    async (name) => {
      const app = anApp()
      const id = await aCodexConversation(app)
      const composed = newestLaunch(app, id).event.given?.thisConversation
      if (composed === undefined || composed === null) throw new Error('no recorded composition')
      const lead = `Composed by ${name} for this conversation at this launch:\n\n${composed.text}`
      const ordinal = app.store.nextOrdinal(id)
      app.store.append(
        id,
        ordinal,
        {
          type: 'user_turn',
          text: 'older row',
          sent: `${lead}\n\nolder row`,
        },
        Date.now(),
      )
      const rows = app.store.threadLeadRows?.(
        id,
        LEADS_OPEN_WITH,
        undefined,
        'Composed by BroBot for this conversation at this launch',
      )
      if (rows === undefined) throw new Error('no thread reader')
      const held = whatTheThreadHolds(leadRowsFrom(rows), Infinity)
      expect(held.carried).toEqual([{ ordinal, is: 'whole', text: lead, firstOfItsLaunch: true }])
      expect(theLeadOwed(held, composed)).toBeNull()
    },
  )

  it.each(['Broom', 'BroCrewX'])(
    'does not treat the unrelated %s prefix as a held lead, even with metadata',
    async (name) => {
      const app = anApp()
      const id = await aCodexConversation(app)
      const composed = newestLaunch(app, id).event.given?.thisConversation
      if (composed === undefined || composed === null) throw new Error('no recorded composition')
      const lead = `Composed by ${name} for this conversation at this launch:\n\n${composed.text}`
      const ordinal = app.store.nextOrdinal(id)
      app.store.append(
        id,
        ordinal,
        {
          type: 'user_turn',
          text: 'unrelated',
          sent: `${lead}\n\nunrelated`,
          lead: { is: 'whole', chars: lead.length },
        },
        Date.now(),
      )
      const rows = app.store.threadLeadRows?.(
        id,
        LEADS_OPEN_WITH,
        undefined,
        'Composed by BroBot for this conversation at this launch',
      )
      if (rows === undefined) throw new Error('no thread reader')
      expect(rows.find((row) => row.ordinal === ordinal)).toMatchObject({
        sent: null,
        handedOver: true,
      })
      const held = whatTheThreadHolds(leadRowsFrom(rows), Infinity)
      expect(held.carried).toEqual([])
      expect(theLeadOwed(held, composed)).toEqual({
        is: 'whole',
        text: conversationBlock(composed.text),
      })
    },
  )

  // ── §4 ───────────────────────────────────────────────────────────────────

  /**
   * `main/index.ts`'s reader with the profile's saved methods: the text composed as every record
   * keeps it, and the model sent the index's lines.
   */
  const withSavedMethods: Reader = (provider, cwd, providerHome, context) => {
    const userData = dirname(dirname(dirname(providerHome)))
    const savedMethods = readSavedMethods(join(dirname(providerHome), 'runbooks'), Date.now())
    const lines = savedMethodsLinesOf(savedMethods)
    const composed = profileBundleSpans(context)
    const bundle = publishProfileBundle(provider, providerHome, composed.text)
    const read = readSessionInstructions({
      provider,
      cwd,
      providerHome,
      bundle,
      bundleComposed: composed,
      thisConversation: thisConversationSpans(
        { ...context, savedMethods },
        toolsToldInTextFor(provider),
      ),
      workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
      workspaceOwnFiles: workspaceOwnFilesIn(userData),
      home: userData,
    })
    return {
      instructions: read.instructions,
      systemHint: read.systemHint === null ? undefined : withTheLinesSent(read.systemHint, lines),
      ...(read.firstTurnLead === null
        ? {}
        : { firstTurnLead: withTheLinesSent(read.firstTurnLead, lines) }),
      ...(lines === null ? {} : { savedMethodsLines: lines }),
      memoryLoaded: read.memoryLoaded,
      profileFile: read.profileFile,
      savedMethods: savedMethodsUseOf(savedMethods),
    }
  }

  it('§4 · the saved-methods index reaches the model on a start and a reopen, and no row keeps its lines', async () => {
    // The app-server reflects each turn's input back, as it does, so its echo is recorded too.
    script.echoInput = true
    const app = anApp(withSavedMethods)
    const folder = join(app.userData, 'provider-homes', 'ali', 'runbooks')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'rotate.md'), '# A fictional method\n')
    const TITLE = 'Rotate the fictional log zq7'
    writeFileSync(
      join(folder, 'index.md'),
      `- ${TITLE} | when it fills | verified 2026-10-12 | rotate.md\n`,
    )
    const sentTo = (at: number): string =>
      JSON.stringify(
        madeTransports
          .flatMap((one) => one.requests)
          .filter((request) => request.method === 'turn/start')
          .slice(at)
          .map((request) => request.params),
      )
    const before = madeTransports
      .flatMap((one) => one.requests)
      .filter((one) => one.method === 'turn/start').length

    const id = await aCodexConversation(app)
    await saying(app, id, 'hello')
    // The model was sent the lines; the message's row and the launch's record keep none of them.
    expect(sentTo(before)).toContain(TITLE)
    // Premise: the echo, the provider's error and the MCP diagnostic were recorded, each with the
    // text that was sent, in its kept form.
    const MARKER = 'The 1 saved method listed here is not kept in this record'
    const echoes = ledger(app, id).filter(
      (event) => event.type === 'unknown' && event.category === 'echo',
    )
    const errors = ledger(app, id).filter(
      (event) => event.type === 'error' && event.message.startsWith('fictional failure'),
    )
    const diagnostics = ledger(app, id).filter(
      (event) => event.type === 'unknown' && event.category === 'activity',
    )
    for (const rows of [echoes, errors, diagnostics]) {
      expect(rows.length).toBeGreaterThan(0)
      expect(JSON.stringify(rows)).toContain(MARKER)
    }
    // What holds no index is kept as it came: the agent's own answer.
    expect(
      ledger(app, id).some((event) => event.type === 'assistant_message' && event.text === 'ok'),
    ).toBe(true)
    const [first] = messagesAfter(app, id, -1)
    expect(first?.event.sent).toContain('The 1 saved method listed here is not kept in this record')
    expect(JSON.stringify(app.store.events(id))).not.toContain(TITLE)
    // The row's lead is the kept text, at its kept length, so a later life reads it back whole.
    const block = wholeLeadOf(newestLaunch(app, id))
    expect(first?.event.sent?.startsWith(`${block}\n\n`)).toBe(true)
    expect(first?.event.lead).toEqual({ is: 'whole', chars: block.length })

    // A second method saved before the reopen changes the section, so the reopen owes it again.
    const SECOND = 'Check the fictional backup qx4'
    writeFileSync(join(folder, 'backup.md'), '# Another fictional method\n')
    writeFileSync(
      join(folder, 'index.md'),
      `- ${TITLE} | when it fills | verified 2026-10-12 | rotate.md\n- ${SECOND} | weekly | verified 2026-10-13 | backup.md\n`,
    )
    const atReopen = madeTransports
      .flatMap((one) => one.requests)
      .filter((one) => one.method === 'turn/start').length
    await reopen(app, id)
    await saying(app, id, 'again')
    // What it owes is read from the records, which keep no lines; the model is sent them.
    expect(sentTo(atReopen)).toContain(SECOND)
    // Two methods: the lines hold a newline, so the echo's JSON copy holds them escaped.
    const ledgerNow = JSON.stringify(app.store.events(id))
    expect(ledgerNow).not.toContain(TITLE)
    expect(ledgerNow).not.toContain(SECOND)
    expect(ledgerNow).toContain('The 2 saved methods listed here are not kept in this record')
  })

  // ── §5 ───────────────────────────────────────────────────────────────────

  /**
   * A reopen whose "This conversation" section changed since its thread last got it: c1 says one
   * message, a second conversation of the profile starts (which c1's section lists), and c1 reopens.
   */
  const aReopenThatOwesWhatChanged = async (app: App) => {
    const c1 = await aCodexConversation(app)
    await saying(app, c1, 'one')
    await aCodexConversation(app)
    const asked = Date.now()
    const reopened = await reopen(app, c1)
    const tookMs = Date.now() - asked
    await saying(app, c1, 'two')
    const [two] = messagesAfter(app, c1, reopened.ordinal)
    return { c1, reopened, tookMs, two, block: wholeLeadOf(reopened) }
  }

  it('§5 · a leads read answered at once still owes only what changed', async () => {
    const app = anApp(undefined, 'at-once')
    const { c1, two } = await aReopenThatOwesWhatChanged(app)
    expect(leadsAsked).toContain(c1)
    expect(two?.event.lead?.is).toBe('what-changed')
    expect(two?.event.sent?.startsWith(`${WHAT_CHANGED_HEADER}\n\n`)).toBe(true)
  })

  it('§5 · a leads read that never answers does not hold the reopen: the whole text is owed', async () => {
    const app = anApp(undefined, 'never')
    const { c1, tookMs, two, block } = await aReopenThatOwesWhatChanged(app)
    expect(leadsAsked).toContain(c1)
    // The reopen waited out the grace (60 ms here), not the read.
    expect(tookMs).toBeLessThan(2_000)
    expect(two?.event.lead).toEqual({ is: 'whole', chars: block.length })
    expect(two?.event.sent?.startsWith(`${block}\n\n`)).toBe(true)
  })

  it('§5 · a leads read that answers after its grace is dropped, and no later turn takes it', async () => {
    const app = anApp(undefined, { afterMs: 300 })
    const { c1, reopened, two, block } = await aReopenThatOwesWhatChanged(app)
    expect(two?.event.lead).toEqual({ is: 'whole', chars: block.length })
    // The late answer arrives; the next message carries no lead at all.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await saying(app, c1, 'three')
    const [, three] = messagesAfter(app, c1, reopened.ordinal)
    expect(three?.event.lead).toBeUndefined()
    expect(three?.event.sent?.startsWith(THIS_CONVERSATION_HEADER)).toBe(false)
    expect(three?.event.sent?.startsWith(WHAT_CHANGED_HEADER)).toBe(false)
  })

  it('§5 · a leads read that fails owes the whole text, as before', async () => {
    const app = anApp(undefined, 'fails')
    const { two, block } = await aReopenThatOwesWhatChanged(app)
    expect(two?.event.lead).toEqual({ is: 'whole', chars: block.length })
  })

  it('§5 · with saved methods and a leads read that never answers, the model gets the lines and no row keeps them', async () => {
    script.echoInput = true
    const app = anApp(withSavedMethods, 'never')
    const folder = join(app.userData, 'provider-homes', 'ali', 'runbooks')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'rotate.md'), '# A fictional method\n')
    const TITLE = 'Rotate the fictional log kw3'
    writeFileSync(
      join(folder, 'index.md'),
      `- ${TITLE} | when it fills | verified 2026-10-12 | rotate.md\n`,
    )
    const c1 = await aCodexConversation(app)
    await saying(app, c1, 'one')
    const atReopen = madeTransports
      .flatMap((one) => one.requests)
      .filter((one) => one.method === 'turn/start').length
    const reopened = await reopen(app, c1)
    await saying(app, c1, 'two')
    const sent = JSON.stringify(
      madeTransports
        .flatMap((one) => one.requests)
        .filter((request) => request.method === 'turn/start')
        .slice(atReopen)
        .map((request) => request.params),
    )
    // The whole text went, with the index's lines in it for the model…
    expect(sent).toContain(TITLE)
    const [two] = messagesAfter(app, c1, reopened.ordinal)
    expect(two?.event.lead?.is).toBe('whole')
    // …and every row keeps the marker in their place.
    expect(two?.event.sent).toContain('The 1 saved method listed here is not kept in this record')
    expect(JSON.stringify(app.store.events(c1))).not.toContain(TITLE)
  })
})
