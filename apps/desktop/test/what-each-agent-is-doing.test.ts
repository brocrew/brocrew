import { RecordingSink, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeRuntime,
  runtimeEventSchema,
  type RuntimeEvent,
  type SessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { BeingDoneTracker } from '../src/main/runtime/being-done'
import {
  ACTIVITY_PHASES,
  activityOf,
  byConversation,
  byIdentity,
  whatAPlateCanDraw,
  type ConversationAtWork,
} from '../src/shared/what-is-being-done'
import { sessionDoing } from '../src/renderer/src/lib/agent-state'
import { conversationList } from '../src/renderer/src/lib/conversation-list'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const NOBODY_IS_WATCHING = null

class CapturingRuntime extends FakeRuntime {
  readonly issued: Awaited<ReturnType<FakeRuntime['start']>>[] = []
  override async start(opts: StartOptions) {
    const handle = await super.start(opts)
    this.issued.push(handle)
    return handle
  }
  latest() {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

/** A handle whose stream the test pushes into, one event at a time. */
function pushable(handle: SessionHandle): {
  readonly handle: SessionHandle
  push: (event: RuntimeEvent) => void
} {
  const waiting: RuntimeEvent[] = []
  let wake: (() => void) | null = null
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return () => ({
          async *[Symbol.asyncIterator]() {
            for (;;) {
              while (waiting.length > 0) yield waiting.shift() as RuntimeEvent
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            }
          },
        })
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return {
    handle: proxied,
    push: (event) => {
      waiting.push(event)
      wake?.()
      wake = null
    },
  }
}

/** Holds a slot in `closing` until the gate opens. */
function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const WORKING = { type: 'status', state: 'working' } as RuntimeEvent
const IDLE = { type: 'status', state: 'idle' } as RuntimeEvent

describe('what each agent is doing', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let runtimes: Map<Provider, CapturingRuntime>
  let counter: number
  let storeCalls: string[]
  const streams = new Map<string, (event: RuntimeEvent) => void>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-doing-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    runtimes = new Map()
    streams.clear()
    counter = 0
    storeCalls = []
    const real = createSessionStore(db)
    store = new Proxy(real, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          storeCalls.push(String(property))
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    }) as SessionStore
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => {
        const held = runtimes.get(provider) ?? new CapturingRuntime(provider)
        runtimes.set(provider, held)
        return held
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (
    profileId: string,
    sink: RuntimeEventSink | null = NOBODY_IS_WATCHING,
    holdItsClose: Promise<void> | null = null,
  ): Promise<string> => {
    const runtime = runtimes.get('claude') ?? new CapturingRuntime('claude')
    runtimes.set('claude', runtime)
    const start = runtime.start.bind(runtime)
    let pushTo: ((event: RuntimeEvent) => void) | null = null
    runtime.start = async (opts: StartOptions) => {
      const plain = await start(opts)
      const driven = pushable(plain)
      pushTo = driven.push
      return (
        holdItsClose === null ? driven.handle : holdingItsClose(driven.handle, holdItsClose)
      ) as never
    }
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, profileId, approvalMode: 'auto' },
      sink,
    )
    runtime.start = start
    if (pushTo === null) throw new Error('the runtime never started a session')
    streams.set(sessionId, pushTo)
    return sessionId
  }

  const aTurnBegins = async (sessionId: string, sink: RuntimeEventSink): Promise<void> => {
    await host.send(sessionId, 'do the thing', sink)
    await say(sessionId, WORKING)
  }

  /** Push one event into a conversation's stream and wait for the host to have folded it. */
  const say = async (sessionId: string, event: RuntimeEvent): Promise<void> => {
    const push = streams.get(sessionId)
    if (push === undefined) throw new Error(`no stream held for ${sessionId}`)
    const before = store.events(sessionId).length
    push(event)
    await waitFor(
      () => store.events(sessionId).length > before,
      `${sessionId} to record a ${event.type}`,
    )
  }

  const rowFor = (sessionId: string): ConversationAtWork => {
    const row = byConversation(host.whatIsBeingDone()).get(sessionId)
    if (row === undefined) throw new Error(`no doing row for ${sessionId}`)
    return row
  }

  const recordedRow = (sessionId: string) =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )

  const wordFor = (sessionId: string): string => {
    const row = rowFor(sessionId)
    const recorded = recordedRow(sessionId)?.status ?? null
    return sessionDoing({
      phase: null,
      liveness: null,
      ...whatAPlateCanDraw(row, recorded),
    })
  }

  describe('the read tells conversations apart', () => {
    it('two working conversations are told apart, in the provider’s own words', async () => {
      const window1 = new RecordingSink('webContents:1')
      const thinking = await open('alice', window1)
      const running = await open('bob', window1)
      await aTurnBegins(thinking, window1)
      await aTurnBegins(running, window1)
      await say(thinking, { type: 'activity', phase: 'thinking' })
      await say(running, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })

      expect(rowFor(thinking).told).toEqual({
        said: 'an-activity',
        phase: 'thinking',
        detail: null,
      })
      expect(rowFor(running).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
      expect(wordFor(thinking)).toBe('thinking')
      expect(wordFor(running)).toBe('tool')
    })

    it('every row names the identity it runs as, folded as the one list spells it', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      expect(rowFor(one).identity).toBe('alice')
      const row = conversationList({
        resumable: host.resumableSessions(),
        unresumable: host.unresumableSessions(),
      }).find((each) => each.sessionId === one)
      expect(row, 'the one list does not hold the conversation').toBeDefined()
      expect(row?.identity).toBe(rowFor(one).identity)
    })
  })

  describe('the honest absences', () => {
    it('a conversation that has said nothing reads `nothing-has-arrived`, never idle', async () => {
      const silent = await open('alice')
      expect(rowFor(silent).told).toEqual({ said: 'nothing', because: 'nothing-has-arrived' })
      const recorded = recordedRow(silent)
      expect(recorded?.status).toBe('idle')
      expect(whatAPlateCanDraw(rowFor(silent), 'idle').status).toBeNull()
      expect(wordFor(silent)).toBe('unknown')
    })

    it('…and the moment ANY event arrives the recorded status is let through', async () => {
      const silent = await open('alice')
      await say(silent, { type: 'thinking', phase: 'delta', redacted: true })
      expect(rowFor(silent).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(whatAPlateCanDraw(rowFor(silent), 'idle').status).toBe('idle')
      expect(wordFor(silent)).toBe('idle')
    })

    it('a frame this build could not read DROPS the phase rather than carrying it', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'activity', phase: 'tool', detail: 'Bash' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })

      await say(one, {
        type: 'unknown',
        provider: 'claude',
        category: 'unrecognized',
        raw: { phase: 'a-phase-this-build-has-never-heard-of' },
        degradedFrom: 'activity',
      })
      expect(rowFor(one).told).toEqual({
        said: 'nothing',
        because: 'a-frame-this-app-could-not-read',
      })
      expect(wordFor(one)).toBe('working')
    })

    it('…and an ordinary `unknown` leaves the phase exactly where it was', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, { type: 'activity', phase: 'tool', detail: 'Bash' })
      await say(one, {
        type: 'unknown',
        provider: 'claude',
        category: 'reasoning',
        raw: { chatter: true },
      })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
    })

    it('a turn ending clears the phase to `no-activity-right-now`', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, { type: 'activity', phase: 'thinking' })
      await say(one, { type: 'turn', state: 'completed' })
      expect(rowFor(one).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
    })

    it('`since` moves when the answer moves and stands still when it does not', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, { type: 'activity', phase: 'thinking' })
      const first = rowFor(one).since
      await say(one, { type: 'activity', phase: 'thinking' })
      expect(rowFor(one).since).toBe(first)
      await say(one, { type: 'activity', phase: 'tool', detail: 'Bash' })
      expect(rowFor(one).since).toBeGreaterThanOrEqual(first)
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
    })

    it('`readAt` is the read’s own moment and never a row’s', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      const first = host.whatIsBeingDone()
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = host.whatIsBeingDone()
      expect(second.readAt).toBeGreaterThan(first.readAt)
      expect(second.conversations[0]?.since).toBe(first.conversations[0]?.since)
    })
  })

  describe('a late activity and the turn boundary', () => {
    it('a late activity is cleared by the next turn’s status transition', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'turn', state: 'completed' })
      await say(one, IDLE)
      await say(one, { type: 'activity', phase: 'waiting' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'waiting', detail: null })
      expect(wordFor(one)).toBe('idle')

      await aTurnBegins(one, window1)
      expect(rowFor(one).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(wordFor(one)).toBe('working')
    })

    it('…and a REPEATED status leaves a live phase exactly where it is', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })
      await say(one, WORKING)
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
      expect(wordFor(one)).toBe('tool')
    })

    it('a sub-agent’s tool call is not the conversation’s activity, and a top-level one is', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, {
        type: 'tool_call',
        id: 'child-1',
        name: 'Grep',
        summary: 'the child’s work',
        parentToolCallId: 'task-1',
      })
      expect(rowFor(one).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      await say(one, { type: 'tool_call', id: 'mine-1', name: 'Grep', summary: 'my own work' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Grep' })
    })

    it('streaming outranks a phase that has not been cleared yet', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })
      await say(one, { type: 'tool_result', id: 't1', summary: 'ran ok', ok: true })
      expect(wordFor(one)).toBe('tool')
      await say(one, { type: 'assistant_delta', text: 'here is what I found' })
      expect(rowFor(one).streaming).toBe(true)
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
      expect(wordFor(one)).toBe('replying')
      await say(one, { type: 'assistant_message', text: 'here is what I found' })
      expect(rowFor(one).streaming).toBe(false)
    })
  })

  describe('the population is the slot map, and the read touches no store', () => {
    it('a conversation this app is not running has no row, and a recording never appears', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      expect(byConversation(host.whatIsBeingDone()).has(one)).toBe(true)

      await host.close(one, THE_APP_ITSELF)
      expect(recordedRow(one)?.sessionId).toBe(one)
      expect(byConversation(host.whatIsBeingDone()).has(one)).toBe(false)
    })

    it('a slot in `closing` is out of the reading, while its tracker still holds a phase', async () => {
      const gate = deferred()
      const one = await open('alice', NOBODY_IS_WATCHING, gate.promise)
      await say(one, WORKING)
      await say(one, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })

      const closing = host.close(one, THE_APP_ITSELF)
      await waitFor(
        () => recordedRow(one)?.running === 'not-running',
        'the slot to enter its teardown',
      )
      expect(byConversation(host.whatIsBeingDone()).has(one)).toBe(false)
      gate.release()
      await closing
    })

    it('the read reaches the database zero times', async () => {
      const one = await open('alice')
      const two = await open('bob')
      await say(one, WORKING)
      await say(two, WORKING)
      storeCalls = []
      const reading = host.whatIsBeingDone()
      expect(reading.conversations).toHaveLength(2)
      expect(storeCalls).toEqual([])
      host.resumableSessions()
      expect(storeCalls.length).toBeGreaterThan(0)
    })

    it('a conversation a window owns is in the reading, like every other running one', async () => {
      const watched = await open('alice', new RecordingSink('webContents:1'))
      const unwatched = await open('bob')
      await say(watched, WORKING)
      await say(unwatched, WORKING)
      const ids = [...byConversation(host.whatIsBeingDone()).keys()].sort()
      expect(ids).toEqual([watched, unwatched].sort())
    })
  })

  describe('the fold’s output', () => {
    it('a phase with no detail carries no `detail` key at all', () => {
      const told = { said: 'an-activity', phase: 'thinking', detail: null } as const
      const activity = activityOf(told)
      expect(activity).not.toBeNull()
      expect(Object.keys(activity ?? {})).toEqual(['phase'])
      expect(activityOf({ said: 'nothing', because: 'no-activity-right-now' })).toBeNull()
    })
  })

  describe('grouped by identity', () => {
    it('one identity running two conversations is TWO rows, never one folded answer', async () => {
      const first = await open('alice')
      const second = await open('alice')
      const other = await open('bob')
      await say(first, WORKING)
      await say(second, WORKING)
      await say(other, WORKING)
      await say(first, { type: 'activity', phase: 'thinking' })
      await say(second, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'x' })

      const reading = host.whatIsBeingDone()
      const grouped = byIdentity(reading)
      expect(grouped.get('alice')).toHaveLength(2)
      expect(grouped.get('bob')).toHaveLength(1)
      expect(
        (grouped.get('alice') ?? [])
          .map((row) => row.told)
          .sort((a, b) => a.said.localeCompare(b.said)),
      ).toEqual([
        { said: 'an-activity', phase: 'thinking', detail: null },
        { said: 'an-activity', phase: 'tool', detail: 'Bash' },
      ])
    })
  })

  describe('the vocabulary, closed and pinned to the runtime’s own', () => {
    it('the phase list is exactly the runtime schema’s own options', () => {
      const activity = runtimeEventSchema.options.find(
        (option) => (option.shape.type as { value: string }).value === 'activity',
      )
      const published = (activity?.shape as { phase: { options: readonly string[] } }).phase.options
      expect([...ACTIVITY_PHASES].sort()).toEqual([...published].sort())
    })

    it('the tracker starts silent, and the first event of any kind ends that', () => {
      const tracker = new BeingDoneTracker(1_000)
      expect(tracker.current).toEqual({
        told: { said: 'nothing', because: 'nothing-has-arrived' },
        streaming: false,
        since: 1_000,
        status: 'idle',
      })
      tracker.observe({ type: 'tool_result', id: 't', summary: 'ok', ok: true }, 2_000)
      expect(tracker.current).toEqual({
        told: { said: 'nothing', because: 'no-activity-right-now' },
        streaming: false,
        since: 2_000,
        status: 'idle',
      })
      tracker.observe({ type: 'tool_result', id: 'u', summary: 'ok', ok: true }, 3_000)
      expect(tracker.current.told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(tracker.current.since).toBe(2_000)
    })

    it('each published phase arrives as itself', () => {
      for (const phase of ACTIVITY_PHASES) {
        const tracker = new BeingDoneTracker(0)
        tracker.observe({ type: 'activity', phase }, 1)
        expect(tracker.current.told).toEqual({ said: 'an-activity', phase, detail: null })
      }
    })
  })
})
