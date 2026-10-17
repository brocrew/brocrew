import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { PS_ARGS, parseProcessTable, psArgsFor, residentSizesIn } from '../src/main/process-tree'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { NOT_LISTED_JUST_NOW } from '../src/main/runtime/process-listing'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { processMemoryWords } from '../src/renderer/src/lib/process-memory'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { ProcessMemory, RuntimeBridge } from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { proseSpans } from './lib/prose-spans'

/**
 * # D-018 · the memory a running agent holds is read by pid, and never kept
 *
 * D-018's agent card says how much memory the process behind a running agent uses ("314 MB in
 * use"). The figure is a person's alone, so what this file pins is the chain that produces it and
 * the rulings written beside each link, none of which any other test reads:
 *
 *  - **§1** the pure arms: the `ps` arguments name the pids and never the whole table, a `ps` that
 *    exited with a status is an answer while one that gave no listing is not, and the words a
 *    figure is drawn in.
 *  - **§2** the host's read over a real ledger and the Fake provider: exactly the pids of the
 *    conversations this app is running (not a closing one, not one with no pid), a process that is
 *    gone is absent and never `0 MB`, nothing forks when nothing runs, askers share the read in
 *    flight and a finished read is never kept, and the window door answers the host's own reading.
 *  - **§3** the renderer store turns a refusal into `null`, never into an empty population.
 *  - **§4** the three places nothing mounts, read as source: main's `ps` call, the preload verb and
 *    the screen's two reads of it.
 *
 * Source is read as TEXT: this is a node file and imports no `.vue`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')
const MiB = 1024 ** 2

// ─── source helpers (the censuses of §4) ───────────────────────────────────────────────────────

/** Every comment blanked, newlines kept, so a docblock quoting the code cannot stand in for it. */
function code(file: string, source: string): string {
  const lines = source.split('\n')
  for (const span of proseSpans(file, source)) {
    span.text.split('\n').forEach((said, offset) => {
      const at = span.line - 1 + offset
      const from = lines[at]?.indexOf(said) ?? -1
      if (from < 0) throw new Error(`${file}:${at + 1} does not hold the comment ${said}`)
      const line = lines[at] ?? ''
      lines[at] = line.slice(0, from) + ' '.repeat(said.length) + line.slice(from + said.length)
    })
  }
  return lines.join('\n')
}

/** The index of a marker that is in the source exactly once. */
function once(marker: string, file: string, source: string): number {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in ${file}`).toBeGreaterThan(-1)
  expect(
    source.indexOf(marker, at + 1),
    `${JSON.stringify(marker)} is in ${file} more than once`,
  ).toBe(-1)
  return at
}

/** From a marker that is in the source once, to (not including) the first `closing` after it. */
function sliceOf(marker: string, closing: string, file: string, source: string): string {
  const at = once(marker, file, source)
  const end = source.indexOf(closing, at)
  expect(end, `${marker} is never closed by ${JSON.stringify(closing)} in ${file}`).toBeGreaterThan(
    at,
  )
  return source.slice(at, end)
}

// ─── the host rig (§2) ─────────────────────────────────────────────────────────────────────────

interface Gate {
  readonly promise: Promise<void>
  readonly release: () => void
}

function deferred(): Gate {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

/**
 * A handle that holds a provider pid the Fake does not have, and optionally holds its teardown open
 * once the provider has announced its ending. Every other member is the Fake's, untouched.
 */
function withAProcess(
  handle: SessionHandle,
  pid: number | undefined,
  gate: Promise<void> | null,
): SessionHandle {
  if (pid === undefined && gate === null) return handle
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'providerPid' && pid !== undefined) return pid
      if (property === 'close' && gate !== null) {
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

class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

type Reader = (pids: readonly number[]) => Promise<ReadonlyMap<number, number>>

/** What `ps` would say each pid holds, in bytes. */
const RESIDENT = new Map<number, number>([
  [4101, 300 * MiB],
  [4102, 1536 * MiB],
])

interface Rig {
  readonly host: RuntimeHost
  readonly userData: string
  readonly ledger: SessionStore
  /** One conversation, whose provider holds `pid` (none when undefined) and parks its close on `gate`. */
  open(pid: number | undefined, sink: RuntimeEventSink | null, gate?: Gate | null): Promise<string>
  /** Let every parked teardown go, close the host and remove what it wrote. */
  dispose(): Promise<void>
}

/** A host over a real SQLite ledger and the Fake provider, with a `ps` reader only when handed one. */
function buildRig(reader: Reader | null): Rig {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-d018-memory-'))
  const db: AppDatabase = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  const ledger = createSessionStore(db)
  const sessions = new FakeProviderSessions()
  const gates: Gate[] = []
  let counter = 0
  let nextPid: number | undefined
  let nextGate: Promise<void> | null = null
  const host = new RuntimeHost({
    store: ledger,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime: (provider: Provider) => {
      const runtime = new FakeRuntime(provider, { sessions })
      const start = runtime.start.bind(runtime)
      const pid = nextPid
      const gate = nextGate
      runtime.start = async (opts) => withAProcess(await start(opts), pid, gate) as never
      return runtime
    },
    prepareProviderHome: (provider: Provider) => {
      const home = join(userData, 'provider-homes', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
    newSessionId: () => `sess_${++counter}`,
    // A bound on the MACHINE, not on the rule: one arm parks a teardown.
    closeDrainTimeoutMs: 40,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
    // Spread in only when a reader is wanted: the dep is optional under exactOptionalPropertyTypes.
    ...(reader === null ? {} : { readProcessMemory: (pids: readonly number[]) => reader(pids) }),
  })
  return {
    host,
    userData,
    ledger,
    open: async (pid, sink, gate = null) => {
      nextPid = pid
      nextGate = gate?.promise ?? null
      if (gate !== null) gates.push(gate)
      const { sessionId } = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'ask' },
        sink,
      )
      nextPid = undefined
      nextGate = null
      return sessionId
    },
    dispose: async () => {
      for (const gate of gates) gate.release()
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
    },
  }
}

/** An answer as `{ conversation: bytes }`, so two answers compare whatever order they were built in. */
const keyed = (answer: ProcessMemory): Record<string, number> =>
  Object.fromEntries(answer.conversations.map((one) => [one.conversation, one.bytes]))

/** What a `ps` for these pids answers: the resident size of each pid it knows. */
const answerFrom = (pids: readonly number[]): ReadonlyMap<number, number> =>
  new Map(
    pids
      .filter((pid) => RESIDENT.has(pid))
      .map((pid): [number, number] => [pid, RESIDENT.get(pid)!]),
  )

/** The log lines among `calls` that say a memory read failed. */
const aboutTheMemoryRead = (calls: readonly (readonly unknown[])[]): string[] =>
  calls.map(([line]) => String(line)).filter((line) => line.includes("conversations' memory"))

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §1 · the pure arms
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§1 · the pure arms of the memory read', () => {
  const LISTING = ['  4101   500  307200 /Users/x/claude', '  4102   500 1572864 /opt/codex'].join(
    '\n',
  )

  it('§1 · psArgsFor names the pids and the columns of the whole-table listing, and lists no other process', () => {
    expect(psArgsFor([4101, 4102])).toEqual(['-o', 'pid=,ppid=,rss=,comm=', '-p', '4101,4102'])
    // One parser reads both listings: the columns are the whole-table listing's own …
    expect(psArgsFor([1])[1]).toBe(PS_ARGS[1])
    expect(parseProcessTable('  4101   500  307200 /Users/x/claude')).toEqual([
      { pid: 4101, ppid: 500, rssBytes: 307200 * 1024, name: 'claude' },
    ])

    // … and no flag of it widens the listing to every process on the machine.
    const widening = /^-[a-z]*[ax]/
    for (const argument of psArgsFor([4101, 4102])) {
      expect(argument, `${argument} lists more than the named pids`).not.toMatch(widening)
    }
    // Paired: the whole-table listing the memory watch needs still starts `-ax`, and the pattern
    // above fires on it, so the negative is about psArgsFor and not about ps flags in general.
    expect(PS_ARGS[0]).toBe('-axo')
    expect(PS_ARGS[0]).toMatch(widening)
  })

  it('§1 · residentSizesIn: an exit status is an answer, no listing is not', () => {
    // The listing is read whenever ps exited with a code, or with no error at all.
    const both = new Map([
      [4101, 300 * MiB],
      [4102, 1536 * MiB],
    ])
    expect(residentSizesIn(null, LISTING)).toEqual(both)
    expect(residentSizesIn({ code: 1 }, LISTING)).toEqual(both)

    // `ps -p` exits 1 and prints nothing when none of the pids is running: an empty population,
    // and not "no answer".
    const none = residentSizesIn({ code: 1 }, '')
    expect(none).not.toBeNull()
    expect(none).toBeInstanceOf(Map)
    expect(none?.size).toBe(0)

    // No listing at all — could not start, overflowed the buffer, killed at its timeout, or an
    // error that carries no exit code — is `null`, beside the arms above that read the same LISTING.
    expect(residentSizesIn({ code: 'ENOENT' }, '')).toBeNull()
    expect(residentSizesIn({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, LISTING)).toBeNull()
    expect(residentSizesIn({ code: null }, LISTING)).toBeNull()
    expect(residentSizesIn({}, LISTING)).toBeNull()
  })

  it('§1 · processMemoryWords says 1024-based MB under a GiB and one-decimal GB from it', () => {
    expect(processMemoryWords(0)).toBe('0 MB')
    expect(processMemoryWords(314 * MiB)).toBe('314 MB')
    expect(processMemoryWords(314.6 * MiB)).toBe('315 MB')
    expect(processMemoryWords(1023 * MiB)).toBe('1023 MB')
    expect(processMemoryWords(1024 * MiB)).toBe('1.0 GB')
    expect(processMemoryWords(1536 * MiB)).toBe('1.5 GB')
    // The unit is pinned, not only the shape: 314 MiB is 329 MB in 1000-based units.
    expect(processMemoryWords(314 * MiB)).not.toBe('329 MB')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §2 · the host
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§2 · the host reads the memory of the processes it runs, by pid', () => {
  let rigs: Rig[] = []
  /** The pids each `ps` was asked for, in order. */
  let asked: number[][] = []
  /** The reader every rig built by `aRig` has; a test replaces it when it wants another. */
  let reader: Reader = async (pids) => answerFrom(pids)

  const aRig = (): Rig => {
    const rig = buildRig((pids) => reader(pids))
    rigs.push(rig)
    return rig
  }

  /** The reader every arm starts with: it records the call, then answers from {@link RESIDENT}. */
  const recording: Reader = async (pids) => {
    asked.push([...pids])
    return answerFrom(pids)
  }

  const sorted = (pids: readonly number[]): number[] => [...pids].sort((a, b) => a - b)

  beforeEach(() => {
    rigs = []
    asked = []
    reader = recording
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const rig of rigs) await rig.dispose()
  })

  it("§2 · asks `ps` for exactly the pids of the conversations this app is running, and answers each one's own bytes", async () => {
    const { host, open } = aRig()
    const unwatched = await open(4101, null)
    const inAWindow = await open(4102, new WindowSink('webContents:1'))
    const noPid = await open(undefined, null)

    // Non-vacuity: both owner states are running here, and a third conversation runs with no pid.
    const rows = [...host.resumableSessions(), ...host.unresumableSessions()]
    const runningOf = (id: string): string | undefined =>
      rows.find((row) => row.sessionId === id)?.running
    expect(runningOf(unwatched)).toBe('unwatched')
    expect(runningOf(inAWindow)).toBe('in-a-window')
    expect(host.sessionIds).toContain(noPid)

    const answer = await host.processMemory()
    expect(asked).toHaveLength(1)
    expect(sorted(asked[0] ?? [])).toEqual([4101, 4102])
    expect(keyed(answer)).toEqual({ [unwatched]: 300 * MiB, [inAWindow]: 1536 * MiB })
    expect(keyed(answer)).not.toHaveProperty(noPid)
  })

  it('§2 · a conversation on its way out and one that has stopped are not read; the one still running is', async () => {
    const { host, ledger, open } = aRig()
    const hold = deferred()
    const closing = await open(4101, null, hold)
    const running = await open(4102, null)

    // The control: before any close, the same host and the same pid ARE read.
    const before = await host.processMemory()
    expect(sorted(asked.at(-1) ?? [])).toEqual([4101, 4102])
    expect(keyed(before)).toEqual({ [closing]: 300 * MiB, [running]: 1536 * MiB })

    // Close the first and hold its teardown open once the provider has announced its ending.
    const ending = host.close(closing, THE_APP_ITSELF)
    await waitFor(
      () => ledger.events(closing).some((one) => one.event.type === 'status'),
      'the provider to announce its ending while the teardown is parked',
    )
    expect(host.sessionIds).toContain(closing)
    const whileClosing = await host.processMemory()
    expect(asked.at(-1)).toEqual([4102])
    expect(keyed(whileClosing)).toEqual({ [running]: 1536 * MiB })

    // And once it has stopped altogether.
    hold.release()
    await ending
    expect(host.sessionIds).not.toContain(closing)
    const afterwards = await host.processMemory()
    expect(asked.at(-1)).toEqual([4102])
    expect(keyed(afterwards)).toEqual({ [running]: 1536 * MiB })
  })

  it('§2 · a process that is gone is absent from the answer, never 0 MB', async () => {
    const { host, open } = aRig()
    const gone = await open(4101, null)
    const alive = await open(4102, null)

    // The first process exited between the pid read and the `ps`: its row is not in the listing.
    reader = async (pids) => {
      asked.push([...pids])
      return new Map([[4102, 1536 * MiB]])
    }
    const answer = await host.processMemory()
    expect(sorted(asked[0] ?? [])).toEqual([4101, 4102])
    expect(answer.conversations).toEqual([{ conversation: alive, bytes: 1536 * MiB }])
    expect(keyed(answer)).not.toHaveProperty(gone)

    // Paired: a reader that answers both pids answers both rows, so the missing row above is the
    // dead pid and not a reader that only ever answers one.
    reader = recording
    expect(keyed(await host.processMemory())).toEqual({
      [gone]: 300 * MiB,
      [alive]: 1536 * MiB,
    })
  })

  it('§2 · nothing running forks nothing, and a host with no reader answers none', async () => {
    const rig = aRig()

    // (a) a reader, and no conversation: the reader is never called.
    expect(await rig.host.processMemory()).toEqual({ conversations: [] })
    expect(asked).toHaveLength(0)

    // (b) the same host with one running conversation: the reader IS called, with its pid, and the
    // row is answered — so (a)'s silence is a decision and not a reader that never answers.
    const one = await rig.open(4101, null)
    expect(await rig.host.processMemory()).toEqual({
      conversations: [{ conversation: one, bytes: 300 * MiB }],
    })
    expect(asked).toEqual([[4101]])

    // (c) a host built without a reader, holding a running conversation with a pid.
    const bare = buildRig(null)
    rigs.push(bare)
    const held = await bare.open(4101, null)
    expect(bare.host.sessionIds).toContain(held)
    expect(await bare.host.processMemory()).toEqual({ conversations: [] })
    // Nothing the bare host did reached the recording reader.
    expect(asked).toEqual([[4101]])
  })

  it('§2 · askers while a read is out share it; the next ask reads afresh; a failed read is said and not kept', async () => {
    const { host, open } = aRig()
    const first = await open(4101, null)
    const second = await open(4102, null)

    // A reader parked on a promise the test releases by hand.
    let release: (sizes: ReadonlyMap<number, number>) => void = () => {}
    reader = (pids) => {
      asked.push([...pids])
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const burst = [host.processMemory(), host.processMemory(), host.processMemory()]
    // One `ps` for all three askers.
    expect(asked).toHaveLength(1)
    release(
      new Map([
        [4101, 300 * MiB],
        [4102, 1536 * MiB],
      ]),
    )
    const answers = await Promise.all(burst)
    expect(keyed(answers[0]!)).toEqual({ [first]: 300 * MiB, [second]: 1536 * MiB })
    expect(answers[1]).toEqual(answers[0])
    expect(answers[2]).toEqual(answers[0])

    // The next ask reads afresh, and answers the NEW bytes — never the first answer again.
    reader = async (pids) => {
      asked.push([...pids])
      return new Map([
        [4101, 400 * MiB],
        [4102, 1600 * MiB],
      ])
    }
    const fresh = await host.processMemory()
    expect(asked).toHaveLength(2)
    expect(keyed(fresh)).toEqual({ [first]: 400 * MiB, [second]: 1600 * MiB })

    // A failed read is not kept either: it is said once, and the very next ask reads again.
    // ⛔ Said, and never an empty list alone: that would read as two conversations not running.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let failures = 0
    reader = async (pids) => {
      asked.push([...pids])
      failures += 1
      if (failures === 1) throw new Error('ps could not start')
      return answerFrom(pids)
    }
    const failed = await host.processMemory()
    expect(failed).toEqual({ conversations: [], unmeasured: NOT_LISTED_JUST_NOW })
    // ⛔ No promise to ask again: the window asks only on its own glance, and only while in front.
    expect(failed.unmeasured).not.toMatch(/again|moment/)
    expect(JSON.stringify(failed)).not.toContain('ps could not start')
    expect(aboutTheMemoryRead(warned.mock.calls)).toHaveLength(1)
    const recovered = await host.processMemory()
    expect(asked).toHaveLength(4)
    expect(recovered).not.toHaveProperty('unmeasured')
    expect(keyed(recovered)).toEqual({ [first]: 300 * MiB, [second]: 1536 * MiB })
  })

  it("§2 · the window door answers the host's own reading, and a pid a renderer names is never read", async () => {
    const { host, open } = aRig()
    const person = new WindowSink('webContents:1')
    const first = await open(4101, null)
    const second = await open(4102, null)

    const answer = (await executeRuntimeCommand(host, person, {
      kind: 'processMemory',
    })) as ProcessMemory
    // It is the memory, and not another read of the host (a forest, say).
    expect(Object.keys(answer)).toEqual(['conversations'])
    expect(keyed(answer)).toEqual({ [first]: 300 * MiB, [second]: 1536 * MiB })
    expect(keyed(answer)).toEqual(keyed(await host.processMemory()))
    expect(asked.length).toBeGreaterThan(0)

    // A pid a renderer names is never read: the schema may strip it or refuse the command, and
    // either way the reader is only ever handed the host's own pids.
    asked = []
    await executeRuntimeCommand(host, person, { kind: 'processMemory', pids: [1, 4102] }).catch(
      () => null,
    )
    expect(asked.flat()).not.toContain(1)
    // Paired, on a reader that does answer the host's own pids in this same file.
    await host.processMemory()
    expect(asked.flat()).toContain(4101)
    expect(asked.flat()).not.toContain(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §3 · the renderer store
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A bridge that answers exactly one verb, over the wire: `everythingOverTheWire` performs the
 * structured clone the shipped app performs, as every renderer store double in this directory does.
 */
const bridgeThat = (over: Record<string, unknown>): RuntimeBridge =>
  everythingOverTheWire({
    onEvent: () => () => {},
    onLiveness: () => () => {},
    ...over,
  }) as unknown as RuntimeBridge

describe('§3 · the renderer store reads the memory', () => {
  it('§3 · the renderer store: a read that did not answer is null, an answer is passed through', async () => {
    let knocks = 0
    const refusing = createRendererStore(
      bridgeThat({
        processMemory: async () => {
          knocks += 1
          throw new Error('the bridge is gone')
        },
      }),
    )
    // A refusal is never an empty population: an empty one says "nothing runs", and this says nothing.
    await expect(refusing.processMemory()).resolves.toBeNull()
    // Non-vacuity: the door really was knocked on, so `null` is the catch and not a stub.
    expect(knocks).toBe(1)

    // The paired positive: an answering bridge's answer reaches the caller. `toEqual` and never
    // `toBe`, because the wire clones the answer.
    const answer: ProcessMemory = {
      conversations: [{ conversation: 'sess_1', bytes: 314572800 }],
    }
    const answering = createRendererStore(bridgeThat({ processMemory: async () => answer }))
    await expect(answering.processMemory()).resolves.toEqual(answer)

    // An answer that holds no conversation is returned as that empty value, and not as `null`.
    const empty = createRendererStore(
      bridgeThat({ processMemory: async (): Promise<ProcessMemory> => ({ conversations: [] }) }),
    )
    await expect(empty.processMemory()).resolves.toEqual({ conversations: [] })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §4 · the places nothing mounts, read as source
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§4 · where the read is made, asked for and drawn', () => {
  it('§4 · main/index.ts reads memory through psArgsFor, by pid, bounded, and never the whole table', () => {
    const main = code('main/index.ts', readFileSync(join(SRC, 'main/index.ts'), 'utf8'))
    const read = sliceOf(
      'readProcessMemory: (pids: readonly number[]) =>',
      "'the process memory read',",
      'main/index.ts',
      main,
    )
    // The slice found something before any negative is asked of it.
    expect(read.length).toBeGreaterThan(200)
    expect(read).toContain('execFile(')
    expect(read).toContain("'ps'")
    expect(read).toContain('psArgsFor(pids)')
    expect(read).toContain('timeout: PS_TIMEOUT_MS')
    expect(read).toContain('residentSizesIn(error, listing)')
    expect(read).toContain('withDeadline(')
    expect(read).toContain('PS_READ_DEADLINE_MS')
    // The whole table is the memory watch's, and never this read's.
    expect(read).not.toMatch(/\bPS_ARGS\b/)
    // On Windows, which has no `ps`: the one listing of the table, by pid.
    expect(read).toContain("process.platform === 'win32'")
    expect(read).toContain('listProcesses().then((rows) => memoryOf(pids, rows))')
  })

  it('§4 · the preload sends the no-payload kind for processMemory', () => {
    const preload = code('preload/index.ts', readFileSync(join(SRC, 'preload/index.ts'), 'utf8'))
    // The neighbour is there, so the read found the preload's verbs and the match below is about this one.
    expect(preload).toContain("command({ kind: 'theWholeForest' })")
    const verb =
      /processMemory:\s*\(\):\s*Promise<ProcessMemory>\s*=>\s*command\(\{ kind: 'processMemory' \}\)/g
    expect(preload.match(verb)).toHaveLength(1)
  })

  /** The screen without its comments, as `one-read-at-a-time.test.ts` §3 reads it. */
  const screen = readFileSync(join(SRC, 'renderer/src/components/RuntimeScreen.vue'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('§4 · RuntimeScreen asks for the memory with the band, on the conversation surface only', () => {
    const band = sliceOf(
      'async function readTheCast(): Promise<void> {',
      '\n}',
      'RuntimeScreen.vue',
      screen,
    )
    const gated = band.indexOf("surface.value === 'conversation'")
    const returned = band.indexOf('if (asked === null) return')
    const asks = band.indexOf('void readProcessMemory()')
    const together = band.indexOf('const answerPending = store.whoCalledWhom(asked)')
    // Presence first: an absent anchor is `-1`, which is "before" everything.
    expect(gated).toBeGreaterThan(-1)
    expect(returned).toBeGreaterThan(-1)
    expect(asks).toBeGreaterThan(-1)
    expect(together).toBeGreaterThan(-1)
    // Two asks in the whole screen: the band's, and the glance's between pushes (W4.74 — the band's
    // own tick went, and the memory moves with no push), both beside the definition.
    expect(screen.match(/\bvoid readProcessMemory\(\)/g)).toHaveLength(2)
    const glance = sliceOf(
      'async function glance(): Promise<void> {',
      '\n}',
      'RuntimeScreen.vue',
      screen,
    )
    expect(glance.indexOf("surface.value === 'conversation'")).toBeGreaterThan(-1)
    expect(glance.indexOf("surface.value === 'conversation'")).toBeLessThan(
      glance.indexOf('void readProcessMemory()'),
    )
    expect(screen).toContain('async function readProcessMemory(): Promise<void> {')
    // After the surface gate and the early return, before the band's own round trip.
    expect(gated).toBeLessThan(returned)
    expect(returned).toBeLessThan(asks)
    expect(asks).toBeLessThan(together)
  })

  it('§4 · a read that did not answer draws no figure, and the screen empties the figures when it goes', () => {
    const reading = sliceOf(
      'async function readProcessMemory(): Promise<void> {',
      '\n}',
      'RuntimeScreen.vue',
      screen,
    )
    // It really does the read and draws from it …
    expect(reading).toContain('await store.processMemory()')
    expect(reading).toContain('cast.processMemory.value = new Map(')
    expect(reading).toContain('held?.conversations ?? []')
    // … and a refusal draws nothing: an early return would keep the last figures, and a kept
    // figure could belong to a process that has since stopped.
    expect(reading).not.toMatch(/\breturn\b/)
    expect(reading).not.toMatch(/\bif\s*\(/)

    // The figures go when the screen goes: the reset is in an `onUnmounted` callback.
    const reset = 'cast.processMemory.value = new Map()'
    const at = once(reset, 'RuntimeScreen.vue', screen)
    const callback = screen.lastIndexOf('onUnmounted(() => {', at)
    expect(callback, 'no onUnmounted callback opens before the reset').toBeGreaterThan(-1)
    expect(screen.slice(callback, at)).not.toContain('\n})')
  })
})
