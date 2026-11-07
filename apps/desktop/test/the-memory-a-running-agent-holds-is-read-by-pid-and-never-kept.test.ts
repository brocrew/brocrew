import { neutralHostDeps } from './lib/host-fixture'
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
import { PS_ARGS, parseProcessTable, psArgsFor, residentSizesIn } from '../src/main/process-tree'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
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

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')
const MiB = 1024 ** 2

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

function once(marker: string, file: string, source: string): number {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in ${file}`).toBeGreaterThan(-1)
  expect(
    source.indexOf(marker, at + 1),
    `${JSON.stringify(marker)} is in ${file} more than once`,
  ).toBe(-1)
  return at
}

function sliceOf(marker: string, closing: string, file: string, source: string): string {
  const at = once(marker, file, source)
  const end = source.indexOf(closing, at)
  expect(end, `${marker} is never closed by ${JSON.stringify(closing)} in ${file}`).toBeGreaterThan(
    at,
  )
  return source.slice(at, end)
}

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

const RESIDENT = new Map<number, number>([
  [4101, 300 * MiB],
  [4102, 1536 * MiB],
])

interface Rig {
  readonly host: RuntimeHost
  readonly userData: string
  readonly ledger: SessionStore
  open(pid: number | undefined, sink: RuntimeEventSink | null, gate?: Gate | null): Promise<string>
  dispose(): Promise<void>
}

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
    ...neutralHostDeps(() => userData),
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
    closeDrainTimeoutMs: 40,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
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

const keyed = (answer: ProcessMemory): Record<string, number> =>
  Object.fromEntries(answer.conversations.map((one) => [one.conversation, one.bytes]))

const answerFrom = (pids: readonly number[]): ReadonlyMap<number, number> =>
  new Map(
    pids
      .filter((pid) => RESIDENT.has(pid))
      .map((pid): [number, number] => [pid, RESIDENT.get(pid)!]),
  )

const aboutTheMemoryRead = (calls: readonly (readonly unknown[])[]): string[] =>
  calls.map(([line]) => String(line)).filter((line) => line.includes("conversations' memory"))

describe('§1 · the pure arms of the memory read', () => {
  const LISTING = ['  4101   500  307200 /Users/x/claude', '  4102   500 1572864 /opt/codex'].join(
    '\n',
  )

  it('§1 · psArgsFor names the pids and the columns of the whole-table listing, and lists no other process', () => {
    expect(psArgsFor([4101, 4102])).toEqual(['-o', 'pid=,ppid=,rss=,comm=', '-p', '4101,4102'])
    expect(psArgsFor([1])[1]).toBe(PS_ARGS[1])
    expect(parseProcessTable('  4101   500  307200 /Users/x/claude')).toEqual([
      { pid: 4101, ppid: 500, rssBytes: 307200 * 1024, name: 'claude' },
    ])

    const widening = /^-[a-z]*[ax]/
    for (const argument of psArgsFor([4101, 4102])) {
      expect(argument, `${argument} lists more than the named pids`).not.toMatch(widening)
    }
    expect(PS_ARGS[0]).toBe('-axo')
    expect(PS_ARGS[0]).toMatch(widening)
  })

  it('§1 · residentSizesIn: an exit status is an answer, no listing is not', () => {
    const both = new Map([
      [4101, 300 * MiB],
      [4102, 1536 * MiB],
    ])
    expect(residentSizesIn(null, LISTING)).toEqual(both)
    expect(residentSizesIn({ code: 1 }, LISTING)).toEqual(both)

    const none = residentSizesIn({ code: 1 }, '')
    expect(none).not.toBeNull()
    expect(none).toBeInstanceOf(Map)
    expect(none?.size).toBe(0)

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
    expect(processMemoryWords(314 * MiB)).not.toBe('329 MB')
  })
})

describe('§2 · the host reads the memory of the processes it runs, by pid', () => {
  let rigs: Rig[] = []
  let asked: number[][] = []
  let reader: Reader = async (pids) => answerFrom(pids)

  const aRig = (): Rig => {
    const rig = buildRig((pids) => reader(pids))
    rigs.push(rig)
    return rig
  }

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

    const before = await host.processMemory()
    expect(sorted(asked.at(-1) ?? [])).toEqual([4101, 4102])
    expect(keyed(before)).toEqual({ [closing]: 300 * MiB, [running]: 1536 * MiB })

    const ending = host.close(closing, THE_APP_ITSELF)
    await waitFor(
      () => ledger.events(closing).some((one) => one.event.type === 'status'),
      'the provider to announce its ending while the teardown is parked',
    )
    expect(host.sessionIds).toContain(closing)
    const whileClosing = await host.processMemory()
    expect(asked.at(-1)).toEqual([4102])
    expect(keyed(whileClosing)).toEqual({ [running]: 1536 * MiB })

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

    reader = async (pids) => {
      asked.push([...pids])
      return new Map([[4102, 1536 * MiB]])
    }
    const answer = await host.processMemory()
    expect(sorted(asked[0] ?? [])).toEqual([4101, 4102])
    expect(answer.conversations).toEqual([{ conversation: alive, bytes: 1536 * MiB }])
    expect(keyed(answer)).not.toHaveProperty(gone)

    reader = recording
    expect(keyed(await host.processMemory())).toEqual({
      [gone]: 300 * MiB,
      [alive]: 1536 * MiB,
    })
  })

  it('§2 · nothing running forks nothing, and a host with no reader answers none', async () => {
    const rig = aRig()

    expect(await rig.host.processMemory()).toEqual({ conversations: [] })
    expect(asked).toHaveLength(0)

    const one = await rig.open(4101, null)
    expect(await rig.host.processMemory()).toEqual({
      conversations: [{ conversation: one, bytes: 300 * MiB }],
    })
    expect(asked).toEqual([[4101]])

    const bare = buildRig(null)
    rigs.push(bare)
    const held = await bare.open(4101, null)
    expect(bare.host.sessionIds).toContain(held)
    expect(await bare.host.processMemory()).toEqual({ conversations: [] })
    expect(asked).toEqual([[4101]])
  })

  it('§2 · askers while a read is out share it; the next ask reads afresh; a failed read is said and not kept', async () => {
    const { host, open } = aRig()
    const first = await open(4101, null)
    const second = await open(4102, null)

    let release: (sizes: ReadonlyMap<number, number>) => void = () => {}
    reader = (pids) => {
      asked.push([...pids])
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const burst = [host.processMemory(), host.processMemory(), host.processMemory()]
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

    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let failures = 0
    reader = async (pids) => {
      asked.push([...pids])
      failures += 1
      if (failures === 1) throw new Error('ps could not start')
      return answerFrom(pids)
    }
    const failed = await host.processMemory()
    expect(failed).toEqual({ conversations: [], unmeasured: 'ps could not start' })
    expect(failed.unmeasured).not.toMatch(/again|moment/)
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
    expect(Object.keys(answer)).toEqual(['conversations'])
    expect(keyed(answer)).toEqual({ [first]: 300 * MiB, [second]: 1536 * MiB })
    expect(keyed(answer)).toEqual(keyed(await host.processMemory()))
    expect(asked.length).toBeGreaterThan(0)

    asked = []
    await executeRuntimeCommand(host, person, { kind: 'processMemory', pids: [1, 4102] }).catch(
      () => null,
    )
    expect(asked.flat()).not.toContain(1)
    await host.processMemory()
    expect(asked.flat()).toContain(4101)
    expect(asked.flat()).not.toContain(1)
  })
})

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
    await expect(refusing.processMemory()).resolves.toBeNull()
    expect(knocks).toBe(1)

    const answer: ProcessMemory = {
      conversations: [{ conversation: 'sess_1', bytes: 314572800 }],
    }
    const answering = createRendererStore(bridgeThat({ processMemory: async () => answer }))
    await expect(answering.processMemory()).resolves.toEqual(answer)

    const empty = createRendererStore(
      bridgeThat({ processMemory: async (): Promise<ProcessMemory> => ({ conversations: [] }) }),
    )
    await expect(empty.processMemory()).resolves.toEqual({ conversations: [] })
  })
})

describe('§4 · where the read is made, asked for and drawn', () => {
  it('§4 · main/index.ts reads memory through psArgsFor, by pid, bounded, and never the whole table', () => {
    const main = code('main/index.ts', readFileSync(join(SRC, 'main/index.ts'), 'utf8'))
    const read = sliceOf(
      'readProcessMemory: (pids: readonly number[]) =>',
      "'the process memory read',",
      'main/index.ts',
      main,
    )
    expect(read.length).toBeGreaterThan(200)
    expect(read).toContain('execFile(')
    expect(read).toContain("'ps'")
    expect(read).toContain('psArgsFor(pids)')
    expect(read).toContain('timeout: PS_TIMEOUT_MS')
    expect(read).toContain('residentSizesIn(error, listing)')
    expect(read).toContain('withDeadline(')
    expect(read).toContain('PS_READ_DEADLINE_MS')
    expect(read).not.toMatch(/\bPS_ARGS\b/)
    expect(read).toContain("process.platform === 'win32'")
    expect(read).toContain('listProcesses().then((rows) => memoryOf(pids, rows))')
  })

  it('§4 · the preload sends the no-payload kind for processMemory', () => {
    const preload = code('preload/index.ts', readFileSync(join(SRC, 'preload/index.ts'), 'utf8'))
    expect(preload).toContain("command({ kind: 'theWholeForest' })")
    const verb =
      /processMemory:\s*\(\):\s*Promise<ProcessMemory>\s*=>\s*command\(\{ kind: 'processMemory' \}\)/g
    expect(preload.match(verb)).toHaveLength(1)
  })

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
    expect(gated).toBeGreaterThan(-1)
    expect(returned).toBeGreaterThan(-1)
    expect(asks).toBeGreaterThan(-1)
    expect(together).toBeGreaterThan(-1)
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
    expect(reading).toContain('await store.processMemory()')
    expect(reading).toContain('cast.processMemory.value = new Map(')
    expect(reading).toContain('held?.conversations ?? []')
    const newest = 'if (mine !== memoryRead) return'
    expect(reading).toContain(newest)
    const drawn = reading.replace(newest, '')
    expect(drawn).not.toMatch(/\breturn\b/)
    expect(drawn).not.toMatch(/\bif\s*\(/)

    const reset = 'cast.processMemory.value = new Map()'
    const at = once(reset, 'RuntimeScreen.vue', screen)
    const callback = screen.lastIndexOf('onUnmounted(() => {', at)
    expect(callback, 'no onUnmounted callback opens before the reset').toBeGreaterThan(-1)
    expect(screen.slice(callback, at)).not.toContain('\n})')
  })
})
