import { neutralHostDeps } from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
  type StartPhase,
} from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import type { WindowReadResult } from '../src/main/db/window-read-protocol'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { StartAttemptLine } from '../src/main/start-attempt-line'

/**
 * Each launch writes two lines, by name and number only: one as it begins, and one as it ends with
 * the phases it reached. A launch given up on at its deadline says which phase it was waiting after.
 */

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly alive = true
  readonly ownerId = 'owner:1'
  send(): void {}
  sendLiveness(): void {}
}

/** The phases a Codex launch reaches, in order. */
const EVERY_PHASE: readonly StartPhase[] = [
  'boot-gate-entered',
  'boot-gate-passed',
  'spawned',
  'initialize-sent',
  'initialized',
  'boot-gate-released',
  'thread-sent',
  'thread-answered',
  'validated',
]

/** A fake provider that reports its phases, and can stop answering after one of them. */
class PhasedRuntime extends FakeRuntime {
  stallAfter: StartPhase | null = null
  holdPhases: ((options: StartOptions | ResumeOptions) => Promise<void>) | null = null
  /** When set, the launch has its session and hands it back only once this settles. */
  answerLate: Promise<void> | null = null
  aborted = false
  readonly handles: Awaited<ReturnType<FakeRuntime['start']>>[] = []
  private say(options: StartOptions | ResumeOptions): Promise<void> {
    if (this.holdPhases !== null) return this.holdPhases(options)
    for (const phase of EVERY_PHASE) {
      options.startPhases?.(phase, phase === 'thread-answered' ? { bytes: 512 } : undefined)
      if (phase === this.stallAfter) {
        // Waits until the launch is given up on, then reaches one phase more, too late to count.
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            options.startPhases?.('thread-answered', { bytes: 9_999 })
            reject(new Error('fictional launch stopped'))
          })
        })
      }
    }
    return Promise.resolve()
  }
  override async start(options: StartOptions) {
    options.signal?.addEventListener('abort', () => {
      this.aborted = true
    })
    await this.say(options)
    const handle = await super.start(options)
    this.handles.push(handle)
    if (this.answerLate !== null) await this.answerLate
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions) {
    await this.say(options)
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    if (this.answerLate !== null) await this.answerLate
    return handle
  }
}

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('a launch says where it waited', () => {
  let folder: string
  let lines: StartAttemptLine[]
  let runtime: PhasedRuntime
  let host: RuntimeHost
  let db: ReturnType<typeof openDatabase>
  let leadRead: (() => Promise<WindowReadResult>) | undefined
  let buildHost: (bounds?: {
    launchTimeoutMs?: number
    resumeTimeouts?: Partial<Record<import('@brobot2/shared').Provider, number>>
  }) => RuntimeHost

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-start-attempts-'))
    db = openDatabase(join(folder, 'fixture.sqlite'))
    applyMigrations(db, migrations)
    let clock = 8_000_000
    const store = createSessionStore(db, () => clock++)
    lines = []
    leadRead = undefined
    runtime = new PhasedRuntime('codex', { sessions: new FakeProviderSessions() })
    let counter = 0
    buildHost = (bounds = { launchTimeoutMs: 80 }) =>
      new RuntimeHost({
        store,
        ...neutralHostDeps(() => folder),
        createRuntime: () => runtime,
        prepareProviderHome: (provider) => join(folder, 'provider-homes', provider),
        providerHomePath: (provider) => join(folder, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(folder, 'scratch', sessionId),
        newSessionId: () => `sess_${++counter}`,
        now: () => clock++,
        windowReader: {
          read: async () => leadRead?.() ?? { kind: 'leads', rows: [] },
          close: async () => {},
        },
        limitsWriterStamp: limitsWriterSampler(db, () => true),
        readInstructions: () => ({
          instructions: {
            injected: [],
            agentMemory: [],
            provider: [],
            refused: [],
            note: '',
            recallsReported: true,
            writesReported: true,
            composed: null,
          },
          systemHint: undefined,
          ...(leadRead === undefined ? {} : { firstTurnLead: 'fictional conversation lead' }),
        }),
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CODEX_HOME',
          model: 'fictional-model',
          authNote: null,
          files: [],
        }),
        ...bounds,
        reopenLeadsGraceMs: 200,
        closeDrainTimeoutMs: 40,
        recordStartAttempt: (line) => lines.push(line),
      })
    host = buildHost()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await host.closeAll()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const ended = () => lines.filter((one) => one.stage === 'ended')

  function heldProgress() {
    let entered!: (options: StartOptions | ResumeOptions) => void
    const options = new Promise<StartOptions | ResumeOptions>((resolve) => {
      entered = resolve
    })
    let finish!: () => void
    let fail!: (error: Error) => void
    const held = new Promise<void>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    runtime.holdPhases = (context) => {
      context.signal?.addEventListener('abort', () => fail(new Error('fictional launch stopped')), {
        once: true,
      })
      entered(context)
      return held
    }
    return { options, finish, fail }
  }

  it.each([
    ['fresh', 15_000],
    ['resume', 60_000],
  ] as const)(
    'a progressing %s launch can exceed its former %i ms total',
    async (opening, idleMs) => {
      await host.closeAll()
      host = buildHost({})
      const sink = new Sink()
      const sessionId =
        opening === 'resume'
          ? (await host.createSession({ provider: 'codex' }, sink)).sessionId
          : null
      if (sessionId !== null) await host.close(sessionId, sink)
      const held = heldProgress()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const launching =
        sessionId === null
          ? host.createSession({ provider: 'codex' }, sink)
          : host.resumeSession(sessionId, sink)
      const failure = launching.catch((error: unknown) => error)
      try {
        const options = await held.options
        options.startPhases?.('spawned')
        await vi.advanceTimersByTimeAsync(idleMs * 0.75)
        options.startPhases?.('initialized')
        await vi.advanceTimersByTimeAsync(idleMs * 0.75)
        options.startPhases?.('thread-answered', { bytes: 128 })
        await vi.advanceTimersByTimeAsync(idleMs * 0.75)
        options.startPhases?.('thread-answered', { bytes: 256 })
        await vi.advanceTimersByTimeAsync(idleMs - 1)
        expect(options.signal?.aborted).toBe(false)
        expect(ended().filter((one) => one.outcome === 'timed-out')).toEqual([])
        held.finish()
        await expect(launching).resolves.toHaveProperty('sessionId')
        expect(ended().at(-1)).toMatchObject({ opening, outcome: 'ready', responseBytes: 256 })
        const count = lines.length
        options.startPhases?.('validated')
        await vi.advanceTimersByTimeAsync(idleMs * 2)
        expect(options.signal?.aborted).toBe(false)
        expect(lines).toHaveLength(count)
      } finally {
        held.finish()
        vi.useRealTimers()
        await failure
      }
    },
  )

  it('replayed stages and nonadvancing or unrelated byte counts do not renew the idle window', async () => {
    const held = heldProgress()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const launching = host.createSession({ provider: 'codex' }, new Sink())
    const failure = launching.catch((error: unknown) => error)
    const options = await held.options
    options.startPhases?.('thread-answered', { bytes: 128 })
    await vi.advanceTimersByTimeAsync(60)
    options.startPhases?.('thread-answered', { bytes: 128 })
    options.startPhases?.('thread-answered', { bytes: 64 })
    options.startPhases?.('thread-answered', { bytes: Number.NaN })
    options.startPhases?.('thread-answered', { bytes: Number.POSITIVE_INFINITY })
    options.startPhases?.('thread-answered', { bytes: -1 })
    options.startPhases?.('thread-answered', { bytes: 128.5 })
    options.startPhases?.('spawned', { bytes: 1_000 })
    options.startPhases?.('initialize-sent')
    await vi.advanceTimersByTimeAsync(19)
    expect(options.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await failure).toBeInstanceOf(Error)
    expect(options.signal?.aborted).toBe(true)
    expect(ended().at(-1)).toMatchObject({ outcome: 'timed-out' })
    const count = lines.length
    options.startPhases?.('validated')
    await vi.advanceTimersByTimeAsync(160)
    expect(lines).toHaveLength(count)
  })

  it('a rejected launch settles immediately after progress rather than waiting for its idle limit', async () => {
    const held = heldProgress()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const launching = host.createSession({ provider: 'codex' }, new Sink())
    const failure = launching.catch((error: unknown) => error)
    const options = await held.options
    options.startPhases?.('spawned')
    await vi.advanceTimersByTimeAsync(60)
    options.startPhases?.('initialized')
    held.fail(new Error('fictional provider exited during initialization'))
    expect(await failure).toBeInstanceOf(Error)
    expect(ended().at(-1)).toMatchObject({ outcome: 'failed' })
    expect(options.signal?.aborted).toBe(false)
    const count = lines.length
    options.startPhases?.('validated')
    await vi.advanceTimersByTimeAsync(160)
    expect(options.signal?.aborted).toBe(false)
    expect(lines).toHaveLength(count)
  })

  it('a fresh start that is ready writes its phases in order, its answer’s size and its outcome', async () => {
    await host.createSession({ provider: 'codex' }, new Sink())
    expect(lines.map((one) => one.stage)).toEqual(['began', 'ended'])
    const began = lines[0]!
    const end = lines[1]!
    expect(began).toMatchObject({ v: 1, provider: 'codex', opening: 'fresh', session: 'sess_1' })
    expect(end.attempt).toBe(began.attempt)
    expect(end.attempt).toMatch(/^att_[0-9a-f-]{36}$/)
    if (end.stage !== 'ended') throw new Error('not an end')
    expect(end).toMatchObject({ outcome: 'ready', lastPhase: 'validated', responseBytes: 512 })
    expect(Object.keys(end.phases)).toEqual(EVERY_PHASE)
    const times = EVERY_PHASE.map((phase) => end.phases[phase]!)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(end.elapsedMs).toBeGreaterThanOrEqual(times.at(-1)!)
  })

  it('a launch given up on at its deadline writes the phase it was waiting after, and nothing after', async () => {
    runtime.stallAfter = 'thread-sent'
    const failure = await host
      .createSession({ provider: 'codex' }, new Sink())
      .catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(lines.map((one) => one.stage)).toEqual(['began', 'ended'])
    const end = ended()[0]!
    if (end.stage !== 'ended') throw new Error('not an end')
    expect(end).toMatchObject({
      outcome: 'timed-out',
      lastPhase: 'thread-sent',
      responseBytes: null,
    })
    expect('thread-answered' in end.phases).toBe(false)
    // Whole-millisecond timers and rounded monotonic samples can differ at the boundary.
    expect(end.elapsedMs).toBeGreaterThanOrEqual(78)
    // The phase reached after the deadline comes too late to be written, and no line follows.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(lines).toHaveLength(2)
  })

  it('a resume writes its own two lines, as a resume', async () => {
    const { sessionId } = await host.createSession({ provider: 'codex' }, new Sink())
    await host.close(sessionId, new Sink())
    await host.resumeSession(sessionId, new Sink())
    const resumed = lines.filter((one) => one.opening === 'resume')
    expect(resumed.map((one) => one.stage)).toEqual(['began', 'ended'])
    expect(resumed[1]).toMatchObject({
      session: sessionId,
      outcome: 'ready',
      lastPhase: 'validated',
    })
    expect(resumed[0]!.attempt).not.toBe(lines[0]!.attempt)
  })

  it('a Codex resume can take twenty seconds, stays active, and records its sixty-second limit', async () => {
    await host.closeAll()
    host = buildHost({})
    const sink = new Sink()
    const { sessionId } = await host.createSession({ provider: 'codex' }, sink)
    await host.close(sessionId, sink)
    let release!: () => void
    runtime.answerLate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const resumed = host.resumeSession(sessionId, sink)
    const keepAlive = setInterval(() => {}, 1_000)
    let state = 'pending'
    const outcome = resumed.then(
      () => {
        state = 'ready'
        return state
      },
      () => {
        state = 'failed'
        return state
      },
    )
    try {
      while (runtime.handles.length < 2) await new Promise<void>((resolve) => setImmediate(resolve))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(state).toBe('pending')
      expect(lines.filter((one) => one.opening === 'resume')).toMatchObject([
        { stage: 'began', timeoutMs: 60_000 },
      ])
      expect(host.agentCard(sessionId, sink, null)?.state).toMatchObject({ is: 'active' })
      release()
      expect(await outcome).toBe('ready')
      expect(lines.filter((one) => one.opening === 'resume')).toMatchObject([
        { stage: 'began', timeoutMs: 60_000 },
        { stage: 'ended', timeoutMs: 60_000, outcome: 'ready' },
      ])
    } finally {
      release()
      vi.useRealTimers()
      await resumed.catch(() => undefined)
      await host.closeAll()
      clearInterval(keepAlive)
    }
  })

  it('a fresh Codex start still expires at fifteen seconds', async () => {
    await host.closeAll()
    host = buildHost({})
    runtime.stallAfter = 'thread-sent'
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const started = host.createSession({ provider: 'codex' }, new Sink())
    const failure = started.catch((error: unknown) => error)
    try {
      while (!lines.some((one) => one.stage === 'began'))
        await new Promise<void>((resolve) => setImmediate(resolve))
      await vi.advanceTimersByTimeAsync(14_999)
      expect(ended()).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(await failure).toMatchObject({ message: expect.stringContaining('within 15s') })
      expect(lines).toMatchObject([
        { stage: 'began', opening: 'fresh', timeoutMs: 15_000 },
        { stage: 'ended', opening: 'fresh', timeoutMs: 15_000, outcome: 'timed-out' },
      ])
    } finally {
      vi.useRealTimers()
      await failure
    }
  })

  it.each([
    ['codex', 60_000],
    ['claude', 15_000],
  ] as const)(
    'an unanswered %s resume expires at its own %i ms limit',
    async (provider, timeoutMs) => {
      await host.closeAll()
      runtime = new PhasedRuntime(provider, { sessions: new FakeProviderSessions() })
      host = buildHost({})
      const sink = new Sink()
      const { sessionId } = await host.createSession({ provider }, sink)
      await host.close(sessionId, sink)
      runtime.stallAfter = 'thread-sent'
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const resumed = host.resumeSession(sessionId, sink)
      const failure = resumed.catch((error: unknown) => error)
      try {
        while (!lines.some((one) => one.opening === 'resume'))
          await new Promise<void>((resolve) => setImmediate(resolve))
        await vi.advanceTimersByTimeAsync(timeoutMs - 1)
        expect(ended().filter((one) => one.opening === 'resume')).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(await failure).toMatchObject({
          message: expect.stringContaining(`within ${timeoutMs / 1000}s`),
        })
        expect(lines.filter((one) => one.opening === 'resume')).toMatchObject([
          { stage: 'began', timeoutMs },
          { stage: 'ended', timeoutMs, outcome: 'timed-out' },
        ])
      } finally {
        vi.useRealTimers()
        await failure
      }
    },
  )

  async function heldLead() {
    const { sessionId } = await host.createSession({ provider: 'codex' }, new Sink())
    await host.close(sessionId, new Sink())
    let finish!: (answer: WindowReadResult) => void
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    leadRead = () =>
      new Promise((resolve) => {
        finish = resolve
        entered()
      })
    const resume = vi.spyOn(runtime, 'resume')
    const asked = host
      .resumeSession(sessionId, new Sink(), 'fictional-reopen')
      .catch((error: unknown) => error)
    await reading
    return { asked, resume, finish: () => finish({ kind: 'leads', rows: [] }) }
  }

  it('a lead read that never answers does not hold the resume: the provider is asked at once and the reopen is ready', async () => {
    const held = await heldLead()
    try {
      // The provider was asked while the read was still out, and reached every phase in time.
      expect(held.resume).toHaveBeenCalledOnce()
      const opened = await Promise.race([
        held.asked,
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 1_000)),
      ])
      expect(opened).toMatchObject({ sessionId: 'sess_1' })
      expect(ended().at(-1)).toMatchObject({
        opening: 'resume',
        outcome: 'ready',
        lastPhase: 'validated',
      })
    } finally {
      held.finish()
      await held.asked
    }
  })

  it('cancelling while the lead read is still out, after the provider answered, stops the provider at once', async () => {
    const held = await heldLead()
    // The provider has answered and the read is still out: the launch is in its grace.
    const deadline0 = Date.now() + 2_000
    while (Date.now() < deadline0 && runtime.handles.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5))
    expect(runtime.handles).toHaveLength(1)
    const asked = Date.now()
    const cancelled = host.cancelLaunch('fictional-reopen', new Sink().ownerId)
    try {
      const failure = await Promise.race([
        held.asked,
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 1_000)),
      ])
      // The words a close during a start has always had; and the grace did not run to its end.
      expect(failure).toMatchObject({ cause: { unavailable: 'lost-its-place' } })
      expect((failure as Error).message).toContain('was closed while it was opening')
      expect(Date.now() - asked).toBeLessThan(150)
      expect(await cancelled).toBe(true)
      // Whatever the provider handed back is not left running.
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && runtime.handles.some((handle) => handle.status() !== 'ended'))
        await new Promise((resolve) => setTimeout(resolve, 5))
      expect(runtime.handles.every((handle) => handle.status() === 'ended')).toBe(true)
    } finally {
      held.finish()
      await held.asked
      await cancelled
    }
  })

  it('a completed lead read lets the same timed resume reach its provider phases', async () => {
    const held = await heldLead()
    held.finish()
    await expect(held.asked).resolves.toMatchObject({ sessionId: 'sess_1' })
    expect(held.resume).toHaveBeenCalledOnce()
    const resumed = lines.filter((one) => one.opening === 'resume')
    expect(resumed.map((one) => one.stage)).toEqual(['began', 'ended'])
    expect(resumed[1]).toMatchObject({ outcome: 'ready', lastPhase: 'validated' })
  })

  it('a resume handle arriving after the deadline is still owned until it is stopped', async () => {
    const held = await heldLead()
    let answer!: () => void
    runtime.answerLate = new Promise<void>((resolve) => {
      answer = resolve
    })
    held.finish()
    try {
      await expect(held.asked).resolves.toMatchObject({ cause: { unavailable: 'took-too-long' } })
      expect(held.resume).toHaveBeenCalledOnce()
      const late = runtime.handles.at(-1)!
      expect(late.status()).not.toBe('ended')
      answer()
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && late.status() !== 'ended')
        await new Promise((resolve) => setTimeout(resolve, 5))
      expect(late.status()).toBe('ended')
    } finally {
      answer()
    }
  })

  it('says names and numbers only: no folder, model, prompt or provider words', async () => {
    const { sessionId } = await host.createSession({ provider: 'codex' }, new Sink())
    await host.send(sessionId, 'A fictional private request.', new Sink())
    const said = JSON.stringify(lines)
    for (const word of [folder, 'scratch', 'provider-homes', 'fictional-model', 'private request'])
      expect(said).not.toContain(word)
    const allowed = new Set([
      'v',
      'attempt',
      'session',
      'provider',
      'opening',
      'at',
      'stage',
      'outcome',
      'elapsedMs',
      'phases',
      'lastPhase',
      'responseBytes',
      'timeoutMs',
    ])
    for (const line of lines) for (const key of Object.keys(line)) expect(allowed).toContain(key)
  })

  it('a timing line that cannot be written does not stop the launch', async () => {
    await host.closeAll()
    host = new RuntimeHost({
      store: createSessionStore(db, () => Date.now()),
      ...neutralHostDeps(() => folder),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(folder, 'provider-homes', provider),
      providerHomePath: (provider) => join(folder, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(folder, 'scratch', sessionId),
      newSessionId: () => 'sess_throws',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fictional-model',
        authNote: null,
        files: [],
      }),
      recordStartAttempt: () => {
        throw new Error('fictional full disk')
      },
    })
    await expect(host.createSession({ provider: 'codex' }, new Sink())).resolves.toMatchObject({
      sessionId: 'sess_throws',
    })
  })
})
