import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import type { WindowReadResult } from '../src/main/db/window-read-protocol'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  aStartAttemptsLog,
  START_ATTEMPTS_FILE,
  START_ATTEMPTS_OLDER_FILE,
  type StartAttemptLine,
  type StartAttemptsFiles,
} from '../src/main/start-attempts-log'

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
  /** When set, the launch has its session and hands it back only once this settles. */
  answerLate: Promise<void> | null = null
  aborted = false
  readonly handles: Awaited<ReturnType<FakeRuntime['start']>>[] = []
  private say(options: StartOptions | ResumeOptions): Promise<void> {
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
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
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
      launchTimeoutMs: 80,
      reopenLeadsGraceMs: 200,
      closeDrainTimeoutMs: 40,
      recordStartAttempt: (line) => lines.push(line),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const ended = () => lines.filter((one) => one.stage === 'ended')

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
    ])
    for (const line of lines) for (const key of Object.keys(line)) expect(allowed).toContain(key)
  })

  it('a timing line that cannot be written does not stop the launch', async () => {
    await host.closeAll()
    host = new RuntimeHost({
      store: createSessionStore(db, () => Date.now()),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
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

/** Files that hold every append until released, and count what reached them. */
type HeldFiles = StartAttemptsFiles & { appends: number; readonly release: () => void }
function heldFiles(): HeldFiles {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const files: HeldFiles = {
    appends: 0,
    release: () => release(),
    makeFolder: async () => undefined,
    sizeOf: async () => 0,
    append: async () => {
      files.appends += 1
      await held
    },
    move: async () => undefined,
  }
  return files
}

const aMoment = () => new Promise((resolve) => setTimeout(resolve, 30))
const stillPending = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([promise.then(() => false), aMoment().then(() => true)])

describe('a launch never waits for its timing to reach the disk', () => {
  let folder: string
  let db: ReturnType<typeof openDatabase>
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-start-attempts-held-'))
    db = openDatabase(join(folder, 'fixture.sqlite'))
    applyMigrations(db, migrations)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  function aHost(runtime: PhasedRuntime, files: StartAttemptsFiles): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: createSessionStore(db, () => Date.now()),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(folder, 'provider-homes', provider),
      providerHomePath: (provider) => join(folder, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(folder, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fictional-model',
        authNote: null,
        files: [],
      }),
      launchTimeoutMs: 80,
      closeDrainTimeoutMs: 40,
      recordStartAttempt: aStartAttemptsLog(folder, { files }).write,
    })
  }

  it('a launch is ready while its timing is still held on the way to the disk', async () => {
    const files = heldFiles()
    const runtime = new PhasedRuntime('codex', { sessions: new FakeProviderSessions() })
    const host = aHost(runtime, files)
    await expect(host.createSession({ provider: 'codex' }, new Sink())).resolves.toMatchObject({
      sessionId: 'sess_1',
    })
    // Nothing reached the disk: the first line is still held, and the second waits behind it.
    await aMoment()
    expect(files.appends).toBe(1)
    files.release()
    await host.closeAll()
  })

  it('a launch past its deadline is aborted on time while its timing is held', async () => {
    const files = heldFiles()
    const runtime = new PhasedRuntime('codex', { sessions: new FakeProviderSessions() })
    runtime.stallAfter = 'thread-sent'
    const host = aHost(runtime, files)
    const asked = Date.now()
    const failure = await host
      .createSession({ provider: 'codex' }, new Sink())
      .catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(runtime.aborted).toBe(true)
    expect(Date.now() - asked).toBeLessThan(80 + 1_000)
    await aMoment()
    expect(files.appends).toBe(1)
    files.release()
    await host.closeAll()
  })

  it('a handle that arrives after the deadline is still stopped, while its timing is held', async () => {
    const files = heldFiles()
    const runtime = new PhasedRuntime('codex', { sessions: new FakeProviderSessions() })
    let answer!: () => void
    runtime.answerLate = new Promise<void>((resolve) => {
      answer = resolve
    })
    const host = aHost(runtime, files)
    const failure = await host
      .createSession({ provider: 'codex' }, new Sink())
      .catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(runtime.handles[0]?.status()).not.toBe('ended')
    answer()
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && !(runtime.handles[0]?.status() === 'ended')) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(runtime.handles[0]?.status()).toBe('ended')
    files.release()
    await host.closeAll()
  })
})

describe('the start-attempts file', () => {
  let folder: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-start-attempts-file-'))
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  const line = (attempt: string): StartAttemptLine => ({
    v: 1,
    attempt,
    session: 'sess_1',
    provider: 'codex',
    opening: 'resume',
    at: '2026-10-13T23:00:00.000Z',
    stage: 'began',
  })
  const bytesOf = (attempt: string) => Buffer.byteLength(`${JSON.stringify(line(attempt))}\n`)
  const sizeOf = (name: string) => {
    const path = join(folder, name)
    return existsSync(path) ? readFileSync(path).length : 0
  }

  it('holds one JSON line per launch line, in the order they were taken', async () => {
    const log = aStartAttemptsLog(folder)
    log.write(line('att_1'))
    log.write(line('att_2'))
    await log.settled()
    const kept = readFileSync(join(folder, START_ATTEMPTS_FILE), 'utf8').trim().split('\n')
    expect(kept.map((one) => (JSON.parse(one) as StartAttemptLine).attempt)).toEqual([
      'att_1',
      'att_2',
    ])
  })

  it('a line that exactly fills the file is taken; the next moves it aside first', async () => {
    const two = bytesOf('att_1') + bytesOf('att_2')
    const log = aStartAttemptsLog(folder, { mostBytes: two })
    log.write(line('att_1'))
    log.write(line('att_2'))
    await log.settled()
    expect(sizeOf(START_ATTEMPTS_FILE)).toBe(two)
    expect(existsSync(join(folder, START_ATTEMPTS_OLDER_FILE))).toBe(false)
    log.write(line('att_3'))
    await log.settled()
    expect(sizeOf(START_ATTEMPTS_OLDER_FILE)).toBe(two)
    expect(sizeOf(START_ATTEMPTS_FILE)).toBe(bytesOf('att_3'))
  })

  it('never lets either file pass its bound, and drops a line larger than it', async () => {
    const most = bytesOf('att_1') * 3
    const log = aStartAttemptsLog(folder, { mostBytes: most })
    for (let at = 0; at < 20; at += 1) log.write(line(`att_${String(at % 10)}`))
    log.write({ ...line('att_big'), session: 'x'.repeat(most) })
    await log.settled()
    expect(sizeOf(START_ATTEMPTS_FILE)).toBeLessThanOrEqual(most)
    expect(sizeOf(START_ATTEMPTS_OLDER_FILE)).toBeLessThanOrEqual(most)
    expect(readFileSync(join(folder, START_ATTEMPTS_FILE), 'utf8')).not.toContain('att_big')
  })

  it('when the file cannot be moved aside, the line is dropped and nothing more is written', async () => {
    const appended: string[] = []
    let size = 0
    const files: StartAttemptsFiles = {
      makeFolder: async () => undefined,
      sizeOf: async () => size,
      append: async (_path, text) => {
        appended.push(text)
        size += Buffer.byteLength(text)
      },
      move: async () => {
        throw new Error('fictional move refused')
      },
    }
    const most = bytesOf('att_1') * 2
    const log = aStartAttemptsLog(folder, { mostBytes: most, files })
    for (let at = 0; at < 6; at += 1) log.write(line(`att_${String(at)}`))
    await log.settled()
    expect(appended).toHaveLength(2)
    expect(size).toBeLessThanOrEqual(most)
    log.write(line('att_after'))
    await log.settled()
    expect(appended).toHaveLength(2)
  })

  it('after one failed move, no later line tries again, even when the move would now work', async () => {
    const appended: string[] = []
    let size = 0
    let moves = 0
    const files: StartAttemptsFiles = {
      makeFolder: async () => undefined,
      sizeOf: async () => size,
      append: async (_path, text) => {
        appended.push(text)
        size += Buffer.byteLength(text)
      },
      move: async () => {
        moves += 1
        if (moves === 1) throw new Error('fictional move refused once')
        size = 0
      },
    }
    const log = aStartAttemptsLog(folder, { mostBytes: bytesOf('att_1') * 2, files })
    // The third line needs the move that fails; the fourth is already waiting behind it.
    for (let at = 0; at < 4; at += 1) log.write(line(`att_${String(at)}`))
    await log.settled()
    log.write(line('att_5'))
    await log.settled()
    expect(moves).toBe(1)
    expect(appended).toHaveLength(2)
  })

  it('takes a line without waiting for the disk, and drops what is past its waiting bound', async () => {
    const files = heldFiles()
    const log = aStartAttemptsLog(folder, { files, mostWaiting: 3 })
    for (let at = 0; at < 10; at += 1) log.write(line(`att_${String(at)}`))
    expect(await stillPending(log.settled())).toBe(true)
    expect(files.appends).toBe(1)
    files.release()
    await log.settled()
    expect(files.appends).toBe(3)
  })
})
