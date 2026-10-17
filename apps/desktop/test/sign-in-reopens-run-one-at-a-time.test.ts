import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { ReopenQueue } from '../src/main/runtime/reopen-queue'
import { MainThreadWork } from '../src/main/stall-watch'
import type {
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('sign-in reopens share a yielding queue', () => {
  let folder: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RuntimeEventSink
  let moved: boolean
  let active: number
  let peak: number
  let resumes: string[]
  let closed: string[]
  let handles: FakeSessionHandle[]
  let messages: RuntimeEventMessage[]
  let fail: Set<string>
  let exits: Map<string, ReturnType<typeof deferred>>
  let launchGates: ReturnType<typeof deferred>[]
  let states: RuntimeStatesMessage[]
  /** A read of the sign-in held until resolved, by provider session, once its handle was closed. */
  let readsHeld: Map<string, ReturnType<typeof deferred>>
  let timing: MainThreadWork
  let workClock: number
  let costs: { close: number; resume: number; send: number; state: number }

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brobot2-sign-in-reopens-'))
    db = openDatabase(join(folder, 'test.sqlite'))
    applyMigrations(db, migrations)
    moved = false
    active = peak = 0
    resumes = []
    closed = []
    handles = []
    messages = []
    fail = new Set()
    exits = new Map()
    launchGates = []
    states = []
    readsHeld = new Map()
    workClock = 0
    costs = { close: 0, resume: 0, send: 0, state: 0 }
    timing = new MainThreadWork(() => workClock)
    const sessions = new FakeProviderSessions()
    let ordinal = 0

    const wire = (handle: FakeSessionHandle): FakeSessionHandle => {
      const current = moved
      Object.defineProperty(handle, 'checkSignIn', {
        value: async () => {
          if (closed.includes(handle.ref.sessionId)) {
            await readsHeld.get(handle.ref.sessionId)?.promise
          }
          return moved && !current
        },
      })
      Object.defineProperty(handle, 'signInSuperseded', { get: () => moved && !current })
      Object.defineProperty(handle, 'awaitProcessExit', {
        value: () => exits.get(handle.ref.sessionId)?.promise,
      })
      const close = handle.close.bind(handle)
      Object.defineProperty(handle, 'close', {
        value: () => {
          workClock += costs.close
          if (!closed.includes(handle.ref.sessionId)) closed.push(handle.ref.sessionId)
          return close()
        },
      })
      handles.push(handle)
      return handle
    }

    class Runtime extends FakeRuntime {
      override async start(...args: Parameters<FakeRuntime['start']>) {
        return wire(await super.start(...args))
      }

      override async resume(...args: Parameters<FakeRuntime['resume']>) {
        workClock += costs.resume
        const [ref] = args
        resumes.push(ref.sessionId)
        peak = Math.max(peak, ++active)
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          if (fail.has(ref.sessionId)) throw new Error('synthetic reopen failure')
          return wire(await super.resume(...args))
        } finally {
          active--
        }
      }
    }

    host = new RuntimeHost({
      mainThreadWork: timing,
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
      createRuntime: (provider) => new Runtime(provider, { sessions }),
      prepareProviderHome: (provider) => join(folder, 'homes', provider),
      providerHomePath: (provider) => join(folder, 'homes', provider),
      resolveCwd: () => folder,
      newSessionId: () => `session_${++ordinal}`,
      closeDrainTimeoutMs: 40,
      statesMoved: (message) => {
        workClock += costs.state
        states.push(message)
      },
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = {
      ownerId: 'window:1',
      alive: true,
      aPersonIsBehindIt: true,
      send: (message) => {
        workClock += costs.send
        messages.push(message)
      },
      sendLiveness: () => {},
    }
  })

  afterEach(async () => {
    for (const receipt of exits.values()) receipt.resolve()
    for (const gate of launchGates) gate.resolve()
    const ending = host.closeAll()
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20_000)
    await ending
    vi.useRealTimers()
    vi.restoreAllMocks()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  async function open(provider: 'claude' | 'codex' = 'claude') {
    const made = await host.createSession({ provider, approvalMode: 'auto' }, sink)
    return { id: made.sessionId, handle: handles.at(-1)! }
  }

  function clock() {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
      ],
    })
  }

  async function note(from: string, to: string, text: string) {
    const tool = agentToolsFor(host, from).tools.find((one) => one.name === 'message_agent')!
    const receipt = await tool.call({ agent: to, text, kind: 'note' })
    expect(receipt.structured).toMatchObject({ outcome: 'ok' })
  }

  function events(id: string): TranscriptEvent[] {
    return messages.filter((message) => message.sessionId === id).map((message) => message.event)
  }

  it.each([1, 3, 10])(
    '%i held conversations close and launch one at a time, preserving each mailbox',
    async (n) => {
      const sender = await open()
      const receivers = []
      for (let i = 0; i < n; i++) receivers.push(await open())
      clock()
      moved = true
      const ticks: number[] = []
      const timer = setInterval(() => ticks.push(Date.now()), 50)
      for (const receiver of receivers) {
        await note(sender.id, receiver.id, 'mail 1')
        await note(sender.id, receiver.id, 'mail 2')
      }
      expect(resumes).toEqual([])
      await vi.advanceTimersByTimeAsync(10)
      expect(resumes).toEqual([receivers[0]!.handle.ref.sessionId])
      expect(closed).toEqual([receivers[0]!.handle.ref.sessionId])
      await vi.advanceTimersByTimeAsync(n * 1000 + 100)
      clearInterval(timer)
      expect(peak).toBe(1)
      expect(resumes).toEqual(receivers.map((receiver) => receiver.handle.ref.sessionId))
      expect(ticks.length).toBeGreaterThanOrEqual(n * 20)
      expect(Math.max(...ticks.slice(1).map((at, i) => at - ticks[i]!))).toBeLessThan(500)
      expect(states.length).toBeGreaterThan(0)
      for (const batch of states) {
        expect(new Set(batch.moved.map((state) => state.conversation)).size).toBe(
          batch.moved.length,
        )
      }
      if (n > 1) expect(states.some((batch) => batch.moved.length > 1)).toBe(true)
      for (const receiver of receivers) {
        expect(events(receiver.id).filter((event) => event.type === 'reopened')).toEqual([
          { type: 'reopened', because: 'the-sign-in-moved-on' },
        ])
        const text = events(receiver.id)
          .filter((event) => event.type === 'user_turn')
          .map((event) => event.text)
          .join('\n')
        expect(text.match(/mail [12]/g)).toEqual(['mail 1', 'mail 2'])
        const endings = events(receiver.id).filter((event) => event.type === 'message_unqueued')
        expect(endings).toHaveLength(2)
        expect(endings.every((event) => event.reason === 'sent')).toBe(true)
      }
    },
  )

  it('a refused turn on the old login uses the same queue as held-message reopens', async () => {
    const sender = await open()
    const held = await open()
    const failed = await open('codex')
    clock()
    moved = true
    await note(sender.id, held.id, 'held')
    await failed.handle.runTurnRefusedOnItsLogin()
    await vi.advanceTimersByTimeAsync(2100)
    expect(peak).toBe(1)
    expect(resumes).toEqual([held.handle.ref.sessionId, failed.handle.ref.sessionId])
    expect(events(failed.id).filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-was-renewed' },
    ])
  })

  it('names provider delivery, flushes and synchronous reopen calls after promise boundaries', async () => {
    const sender = await open()
    const held = await open()
    clock()
    timing.clear()
    costs = { close: 70, resume: 80, send: 610, state: 90 }
    moved = true
    await note(sender.id, held.id, 'fictional held message')
    await vi.advanceTimersByTimeAsync(1100)
    const measured = timing.take()
    for (const phase of [
      'runtime conversation event send',
      'runtime provider event delivery',
      'runtime state building',
      'runtime state flush',
      'runtime sign-in reopen admission',
      'runtime sign-in reopen close',
      'runtime sign-in held resume',
    ]) {
      expect(
        measured.some((one) => one.what === phase),
        phase,
      ).toBe(true)
    }
    expect(measured.find((one) => one.what === 'runtime conversation event send')!.longest).toBe(
      610,
    )
    expect(
      measured.find((one) => one.what === 'runtime sign-in reopen close')!.ms,
    ).toBeGreaterThanOrEqual(70)
    expect(
      measured.find((one) => one.what === 'runtime state flush')!.longest,
    ).toBeGreaterThanOrEqual(90)
    expect(measured.map((one) => one.what).join(' ')).not.toContain('fictional held message')
    expect(resumes).toEqual([held.handle.ref.sessionId])
    expect(events(held.id).filter((event) => event.type === 'message_unqueued')).toHaveLength(1)
  })

  it('real timer ticks stay below the stall floor while three synthetic launch waits run', async () => {
    const sender = await open()
    const receivers = [await open(), await open(), await open()]
    moved = true
    const gaps: number[] = []
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }, 10)
    try {
      for (const receiver of receivers) await note(sender.id, receiver.id, 'held')
      const deadline = performance.now() + 10_000
      while (resumes.length < 3 || active > 0) {
        if (performance.now() >= deadline) throw new Error('reopens did not finish')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      gaps.push(performance.now() - last)
      expect(peak).toBe(1)
      expect(gaps.length).toBeGreaterThan(3)
      expect(Math.max(...gaps)).toBeLessThan(500)
      console.info(
        JSON.stringify({
          reopens: 3,
          peak,
          timerTicks: gaps.length,
          longestGapMs: Math.max(...gaps),
        }),
      )
    } finally {
      clearInterval(timer)
    }
  })

  it('cancelled queued words spend no reopen when their admission turn arrives', async () => {
    const sender = await open()
    const first = await open()
    const cancelled = await open()
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, cancelled.id, 'take this back')
    const queued = events(cancelled.id).find((event) => event.type === 'message_queued')!
    if (queued.type !== 'message_queued' || queued.messageId === undefined) {
      throw new Error('not queued')
    }
    await host.cancelQueuedMessage(cancelled.id, queued.messageId, sink)
    await vi.advanceTimersByTimeAsync(2100)
    expect(resumes).toEqual([first.handle.ref.sessionId])
    expect(closed).not.toContain(cancelled.handle.ref.sessionId)
  })

  it('a manual close while admission waits still starts what the life handed on', async () => {
    const sender = await open()
    const first = await open()
    const later = await open()
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, later.id, 'later')
    await vi.advanceTimersByTimeAsync(10)
    await host.close(later.id, sink)
    await vi.advanceTimersByTimeAsync(2100)
    expect(peak).toBe(1)
    expect(resumes).toEqual([first.handle.ref.sessionId, later.handle.ref.sessionId])
    expect(events(later.id).filter((event) => event.type === 'message_unqueued')).toEqual([
      expect.objectContaining({ reason: 'sent' }),
    ])
  })

  it('a failed old-login life with held words cannot bypass the queue through finalization', async () => {
    const sender = await open()
    const first = await open()
    const failed = await open('codex')
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    failed.handle.simulateThinking({ text: 'a busy life on the old login', redacted: false })
    await vi.advanceTimersByTimeAsync(10)
    expect(failed.handle.status()).toBe('working')
    await note(sender.id, failed.id, 'held')
    const queued = events(failed.id).find((event) => event.type === 'message_queued')!
    if (queued.type !== 'message_queued') throw new Error('not held')
    await failed.handle.runTurnRefusedOnItsLogin()
    await vi.advanceTimersByTimeAsync(500)
    expect(resumes).toEqual([first.handle.ref.sessionId])
    await vi.advanceTimersByTimeAsync(3100)
    expect(peak).toBe(1)
    expect(resumes).toEqual([first.handle.ref.sessionId, failed.handle.ref.sessionId])
    expect(
      events(failed.id).filter(
        (event) => event.type === 'message_unqueued' && event.messageId === queued.messageId,
      ),
    ).toEqual([expect.objectContaining({ reason: 'sent' })])
    expect(events(failed.id).filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-was-renewed' },
    ])
  })

  it('a failed-login restart consumes queued intent so a later ordinary reopen stays ordinary', async () => {
    const sender = await open()
    const first = await open()
    const failed = await open('codex')
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, failed.id, 'held')
    const queued = events(failed.id).find((event) => event.type === 'message_queued')!
    if (queued.type !== 'message_queued') throw new Error('not held')
    await failed.handle.runTurnRefusedOnItsLogin()
    await vi.advanceTimersByTimeAsync(3100)
    expect(resumes).toEqual([first.handle.ref.sessionId, failed.handle.ref.sessionId])
    expect(
      events(failed.id).filter(
        (event) => event.type === 'message_unqueued' && event.messageId === queued.messageId,
      ),
    ).toEqual([expect.objectContaining({ reason: 'sent' })])
    expect(events(failed.id).filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-was-renewed' },
    ])
    await host.close(failed.id, sink)
    const ordinary = host.resumeSession(failed.id, sink)
    await vi.advanceTimersByTimeAsync(1100)
    await ordinary
    expect(events(failed.id).filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-was-renewed' },
      { type: 'reopened' },
    ])
  })

  it.each([false, true])(
    'a failed-login exit receipt waits outside admission (quit later: %s)',
    async (quit) => {
      const sender = await open()
      const late = await open('codex')
      const healthy = await open()
      const receipt = deferred()
      exits.set(late.handle.ref.sessionId, receipt)
      clock()
      moved = true
      await late.handle.runTurnRefusedOnItsLogin()
      await vi.advanceTimersByTimeAsync(200)
      await expect(host.resumeSession(late.id, sink)).rejects.toMatchObject({
        cause: { unavailable: 'not-confirmed-stopped' },
      })
      await note(sender.id, healthy.id, 'healthy')
      await vi.advanceTimersByTimeAsync(1100)
      expect(resumes).toEqual([healthy.handle.ref.sessionId])
      if (quit) {
        const quitting = host.closeAll()
        await vi.advanceTimersByTimeAsync(200)
        await quitting
      }
      receipt.resolve()
      await vi.advanceTimersByTimeAsync(1100)
      expect(resumes).toEqual(
        quit
          ? [healthy.handle.ref.sessionId]
          : [healthy.handle.ref.sessionId, late.handle.ref.sessionId],
      )
      expect(peak).toBe(1)
    },
  )

  it('a held-message cycle with an unconfirmed exit releases admission until the receipt arrives', async () => {
    const sender = await open()
    const late = await open()
    const healthy = await open()
    const receipt = deferred()
    exits.set(late.handle.ref.sessionId, receipt)
    clock()
    moved = true
    await note(sender.id, late.id, 'late')
    await note(sender.id, healthy.id, 'healthy')
    await vi.advanceTimersByTimeAsync(1600)
    expect(resumes).toEqual([healthy.handle.ref.sessionId])
    await expect(host.resumeSession(late.id, sink)).rejects.toMatchObject({
      cause: { unavailable: 'not-confirmed-stopped' },
    })
    receipt.resolve()
    await vi.advanceTimersByTimeAsync(1100)
    expect(resumes).toEqual([healthy.handle.ref.sessionId, late.handle.ref.sessionId])
    expect(events(late.id).filter((event) => event.type === 'message_unqueued')).toEqual([
      expect.objectContaining({ reason: 'sent' }),
    ])
    expect(peak).toBe(1)
  })

  it('a manual start that takes the mailbox wins without a second automatic start', async () => {
    const sender = await open()
    const first = await open()
    const later = await open()
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, later.id, 'later')
    await vi.advanceTimersByTimeAsync(10)
    await host.close(later.id, sink)
    const started = host.resumeSession(later.id, sink)
    await vi.advanceTimersByTimeAsync(2200)
    await started
    expect(resumes.filter((id) => id === later.handle.ref.sessionId)).toHaveLength(1)
    expect(host.sessionIds).toContain(later.id)
    expect(handles.at(-1)!.status()).not.toBe('ended')
    expect(events(later.id).filter((event) => event.type === 'message_unqueued')).toEqual([
      expect.objectContaining({ reason: 'sent' }),
    ])
  })

  function holdNextLaunch() {
    const gate = deferred()
    launchGates.push(gate)
    let entered = false
    const deps = (host as unknown as { deps: { beforeProviderLaunch?: () => Promise<void> } }).deps
    deps.beforeProviderLaunch = async () => {
      if (entered) return
      entered = true
      await gate.promise
    }
    return { resolve: gate.resolve, entered: () => entered }
  }

  it('the next close waits for the full admitted launch cycle, including its launch gate', async () => {
    const sender = await open()
    const first = await open()
    const later = await open()
    const launch = holdNextLaunch()
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, later.id, 'later')
    await vi.advanceTimersByTimeAsync(100)
    expect(launch.entered()).toBe(true)
    expect(resumes).toEqual([])
    expect(closed).toEqual([first.handle.ref.sessionId])
    launch.resolve()
    await vi.advanceTimersByTimeAsync(100)
    expect(resumes).toEqual([first.handle.ref.sessionId])
    expect(closed).toEqual([first.handle.ref.sessionId])
    await vi.advanceTimersByTimeAsync(2100)
    expect(resumes).toEqual([first.handle.ref.sessionId, later.handle.ref.sessionId])
    expect(peak).toBe(1)
  })

  it('an independent finalizer still uses admission after its earlier queued intent was skipped', async () => {
    const sender = await open()
    const first = await open()
    const slow = await open()
    const later = await open()
    const exit = deferred()
    exits.set(slow.handle.ref.sessionId, exit)
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, slow.id, 'slow')
    await note(sender.id, later.id, 'later')
    await vi.advanceTimersByTimeAsync(10)
    const closing = host.close(slow.id, sink)
    await vi.advanceTimersByTimeAsync(1100)
    expect(closed).toContain(slow.handle.ref.sessionId)
    expect(resumes).toEqual([first.handle.ref.sessionId, later.handle.ref.sessionId])
    exit.resolve()
    await closing
    await vi.advanceTimersByTimeAsync(100)
    expect(resumes).toEqual([first.handle.ref.sessionId, later.handle.ref.sessionId])
    await vi.advanceTimersByTimeAsync(2100)
    expect(resumes).toEqual([
      first.handle.ref.sessionId,
      later.handle.ref.sessionId,
      slow.handle.ref.sessionId,
    ])
    expect(peak).toBe(1)
  })

  it('work that starts while queued holds its reopen, then its ending admits it again', async () => {
    const sender = await open()
    const first = await open()
    const later = await open()
    clock()
    moved = true
    await note(sender.id, first.id, 'first')
    await note(sender.id, later.id, 'later')
    later.handle.simulateBackgroundWork()
    await vi.advanceTimersByTimeAsync(2100)
    expect(resumes).toEqual([first.handle.ref.sessionId])
    later.handle.simulateBackgroundWork({ running: [] })
    await vi.advanceTimersByTimeAsync(1100)
    expect(resumes).toEqual([first.handle.ref.sessionId, later.handle.ref.sessionId])
  })

  it('one failed reopen does not prevent the next conversation from reopening', async () => {
    const sender = await open()
    const broken = await open()
    const next = await open()
    fail.add(broken.handle.ref.sessionId)
    clock()
    moved = true
    await note(sender.id, broken.id, 'broken')
    await note(sender.id, next.id, 'next')
    await vi.advanceTimersByTimeAsync(2100)
    expect(peak).toBe(1)
    expect(resumes).toEqual([broken.handle.ref.sessionId, next.handle.ref.sessionId])
    expect(events(next.id).some((event) => event.type === 'reopened')).toBe(true)
  })

  it('quit drops queued admissions and an unchanged login spends no reopen', async () => {
    const sender = await open()
    const receiver = await open()
    clock()
    await note(sender.id, receiver.id, 'unchanged')
    await vi.advanceTimersByTimeAsync(20)
    expect(resumes).toEqual([])
    moved = true
    await note(sender.id, receiver.id, 'held for a reopen')
    const quitting = host.closeAll()
    await vi.advanceTimersByTimeAsync(2000)
    await quitting
    expect(resumes).toEqual([])
  })

  it('a conversation deleted while its reopen waits its turn is not reopened, and nothing more is done or said for it', async () => {
    const first = await open('codex')
    const second = await open('codex')
    clock()
    moved = true
    await first.handle.runTurnRefusedOnItsLogin()
    await second.handle.runTurnRefusedOnItsLogin()
    await vi.advanceTimersByTimeAsync(200)
    // The first reopen is under way; the second waits its turn behind it.
    expect(resumes).toEqual([first.handle.ref.sessionId])
    const decided = (host as unknown as { aReopenIsBeingDecidedFor: Map<string, number> })
      .aReopenIsBeingDecidedFor
    expect(decided.has(second.id)).toBe(true)

    const warned = vi.spyOn(console, 'warn')
    expect(await host.deleteConversation(second.id, ['records'])).toMatchObject({
      done: true,
      removed: ['records'],
    })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(resumes).toEqual([first.handle.ref.sessionId])
    expect(events(first.id).filter((event) => event.type === 'reopened')).toEqual([
      { type: 'reopened', because: 'the-sign-in-was-renewed' },
    ])
    expect(warned.mock.calls.filter(([line]) => String(line).includes(second.id))).toEqual([])
    expect(decided.has(second.id)).toBe(false)
  })

  it('a conversation deleted while its reopen reads the sign-in is not reopened, and nothing more is done or said for it', async () => {
    const only = await open('codex')
    const reading = deferred()
    readsHeld.set(only.handle.ref.sessionId, reading)
    clock()
    moved = true
    await only.handle.runTurnRefusedOnItsLogin()
    await vi.advanceTimersByTimeAsync(200)
    // Ended on the moved sign-in; its reopen has begun, and waits on its read of the sign-in.
    expect(closed).toEqual([only.handle.ref.sessionId])
    expect(resumes).toEqual([])
    const kept = host as unknown as {
      aReopenIsBeingDecidedFor: Map<string, number>
      heldAtAStop: Map<string, unknown>
      heldAsLastRead: Map<string, unknown>
    }
    expect(kept.aReopenIsBeingDecidedFor.has(only.id)).toBe(true)

    const warned = vi.spyOn(console, 'warn')
    expect(await host.deleteConversation(only.id, ['records'])).toMatchObject({
      done: true,
      removed: ['records'],
    })
    reading.resolve()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(resumes).toEqual([])
    expect(warned.mock.calls.filter(([line]) => String(line).includes(only.id))).toEqual([])
    expect(kept.aReopenIsBeingDecidedFor.has(only.id)).toBe(false)
    expect(kept.heldAtAStop.has(only.id)).toBe(false)
    expect(kept.heldAsLastRead.has(only.id)).toBe(false)
  })

  it('a conversation archived while its reopen reads the sign-in stays stopped, and keeps what was held for it', async () => {
    const only = await open('codex')
    const reading = deferred()
    readsHeld.set(only.handle.ref.sessionId, reading)
    clock()
    moved = true
    await only.handle.runTurnRefusedOnItsLogin()
    await vi.advanceTimersByTimeAsync(200)
    expect(closed).toEqual([only.handle.ref.sessionId])

    expect(await host.archiveConversation(only.id)).toEqual({
      done: true,
      conversations: [only.id],
    })
    reading.resolve()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(resumes).toEqual([])
    const kept = host as unknown as { heldAtAStop: Map<string, unknown> }
    expect(kept.heldAtAStop.has(only.id)).toBe(true)
  })
})

describe('reopen admission yields even when each operation is already settled', () => {
  afterEach(() => vi.useRealTimers())

  it('another main-loop callback runs between consecutive jobs', async () => {
    vi.useFakeTimers()
    const queue = new ReopenQueue()
    const ran: string[] = []
    const jobs = [1, 2, 3].map((i) =>
      queue.run(async () => {
        ran.push(`reopen ${i}`)
        setImmediate(() => ran.push(`main ${i}`))
      }),
    )
    await vi.advanceTimersByTimeAsync(10)
    await Promise.all(jobs)
    expect(ran).toEqual(['reopen 1', 'main 1', 'reopen 2', 'main 2', 'reopen 3', 'main 3'])
  })
})
