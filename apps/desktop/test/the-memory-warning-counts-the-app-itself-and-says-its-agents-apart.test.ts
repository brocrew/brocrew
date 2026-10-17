import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  startMemoryWatch,
  whatItsAgentsHoldApart,
  whatTheAppItselfHolds,
  type OwnProcess,
} from '../src/main/memory-watch'
import { createSpawnedReader, describeSpawned, type SpawnedProcess } from '../src/main/process-tree'
import { proseSpans } from './lib/prose-spans'

/**
 * # The memory warning counts BroBot itself, and says its agents apart (a5030808)
 *
 * ⚑ Measured 2026-10-03: across sixteen days of the memory log the app's
 * own processes held 0.4–1.0 GB, and its agents 63–95% of every total the watchdog called *"far
 * above normal"*. The figure the 2 GiB floor is held against is now the app's own (Electron's
 * `getAppMetrics()`, in kilobytes), each named plainly, and what the agents hold is said apart.
 *
 *  - **§1** `whatTheAppItselfHolds`: kilobytes to bytes, each plain name, Electron's order kept.
 *  - **§2** `whatItsAgentsHoldApart`: not read yet, unreadable, none, and a list.
 *  - **§3** the reader leaves out the app's own `ps`, keeps an agent's, and says whether it has read.
 *  - **§4** the app's own line no longer fires on its agents' climb — composed as `index.ts` wires
 *    it, and that wiring read as source.
 */

const here = dirname(fileURLToPath(import.meta.url))
const KB = 1024
const MiB = 1024 ** 2
const GiB = 1024 ** 3

/** One of Electron's metrics rows, `workingSetSize` in KILOBYTES as Electron reports it. */
const own = (type: string, mib: number, name?: string): OwnProcess =>
  name === undefined
    ? { type, memory: { workingSetSize: mib * KB } }
    : { type, name, memory: { workingSetSize: mib * KB } }

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §1 · what the app itself holds
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§1 · whatTheAppItselfHolds', () => {
  /** The report's example line: main 0.29, graphics 0.07, network 0.04, a window grown to 2.60. */
  const METRICS: readonly OwnProcess[] = [
    own('Browser', 300),
    own('GPU', 72),
    own('Utility', 40, 'Network Service'),
    own('Tab', 2662),
  ]

  it('§1 · counts Electron’s kilobytes as bytes', () => {
    const { bytes } = whatTheAppItselfHolds(METRICS)
    expect(bytes).toBe((300 + 72 + 40 + 2662) * MiB)
    // Paired: the kilobyte sum itself is a figure a thousand times too small, and the floor would
    // then never be crossed.
    expect(bytes).not.toBe((300 + 72 + 40 + 2662) * KB)
    expect(bytes).toBeGreaterThan(2 * GiB)
  })

  it('§1 · names each process plainly, in the order Electron lists them', () => {
    // Exactly: neither largest-first (the window would lead) nor by name (graphics would).
    expect(whatTheAppItselfHolds(METRICS).said).toBe(
      'main:0.29GB graphics:0.07GB network:0.04GB window:2.60GB',
    )
    // The order is the input's: reversed in, reversed out.
    expect(whatTheAppItselfHolds([...METRICS].reverse()).said).toBe(
      'window:2.60GB network:0.04GB graphics:0.07GB main:0.29GB',
    )
  })

  it('§1 · a Utility is named by its name, less “ Service”; one with no name is a utility', () => {
    const said = whatTheAppItselfHolds([
      own('Utility', 10, 'Network Service'),
      own('Utility', 10, 'Audio Service'),
      own('Utility', 10, 'Video Capture'),
      own('Utility', 10),
      own('Utility', 10, ''),
      own('Pepper Plugin', 10),
    ]).said
    expect(said.split(' ').map((one) => one.split(':')[0])).toEqual([
      'network',
      'audio',
      'video-capture',
      'utility',
      'utility',
      'pepper-plugin',
    ])
    // None of Chromium's own words is left on the line.
    expect(whatTheAppItselfHolds([own('Browser', 1), own('Tab', 1), own('GPU', 1)]).said).toBe(
      'main:0.00GB window:0.00GB graphics:0.00GB',
    )
    expect(whatTheAppItselfHolds(METRICS).said).not.toMatch(/Browser|Tab|GPU|Utility|Service/)
  })

  it('§1 · nothing listed holds nothing and says nothing', () => {
    expect(whatTheAppItselfHolds([])).toEqual({ bytes: 0, said: '' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §2 · what its agents hold, apart
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§2 · whatItsAgentsHoldApart', () => {
  it('§2 · not read yet, unreadable and none are three different sentences', () => {
    const notYet = whatItsAgentsHoldApart('not-read-yet')
    const unreadable = whatItsAgentsHoldApart('unreadable')
    const none = whatItsAgentsHoldApart([])
    expect(notYet).toBe('What its agents hold has not been read yet.')
    expect(unreadable).toBe('What its agents hold could not be read.')
    expect(none).toBe('None of its agents is running.')
    // An empty list is never said as a listing that failed, nor as one not taken yet.
    expect(new Set([notYet, unreadable, none]).size).toBe(3)
  })

  it('§2 · a list says its total and the largest processes in a bracket', () => {
    const spawned: SpawnedProcess[] = [
      { pid: 600, rssBytes: 256 * MiB, name: 'claude', head: 600 },
      { pid: 601, rssBytes: 1536 * MiB, name: 'node', head: 600 },
    ]
    expect(whatItsAgentsHoldApart(spawned)).toBe(
      'Apart from this, its agents and the commands they run hold 1.75 GB [node:1.50GB claude:0.25GB].',
    )
  })

  it('§2 · the total counts the processes the bracket does not name', () => {
    // Five, one past what the bracket names: the total is all five, and the tail is counted inside.
    const spawned: SpawnedProcess[] = Array.from({ length: 5 }, (_, i) => ({
      pid: 700 + i,
      rssBytes: GiB,
      name: `node${i}`,
      head: 700,
    }))
    const line = whatItsAgentsHoldApart(spawned)
    expect(line).toContain('hold 5.00 GB ')
    expect(line).not.toContain('hold 4.00 GB ')
    expect(line).toContain(`[${describeSpawned(spawned)}]`)
    expect(line).toContain('+1more:1.00GB')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §3 · the reader: the app's own ps left out, and whether it has read
// ═════════════════════════════════════════════════════════════════════════════════════════════

const OUR_PID = 500
const CHROMIUM = new Set([500, 501])

/**
 * Synthetic. `610` is the app's own probe, straight under our pid; `620` is an agent's own `ps`,
 * under that agent; `640` is a command whose name merely starts with `ps`.
 */
const LISTING = [
  '  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2',
  '  501   500  110000 /Applications/BroBot2.app/Contents/Frameworks/Electron Helper (Renderer)',
  '  600   500  400000 /Users/x/.local/bin/claude',
  '  610   500    1200 /bin/ps',
  '  620   600    1300 /bin/ps',
  '  630   600  900000 /usr/local/bin/node',
  '  640   500   50000 /usr/local/bin/psql',
].join('\n')

/** A reader whose `ps` answers only when the test says, and how. */
function aReader() {
  const pending: Array<(error: Error | null, table: string) => void> = []
  let now = 1_000
  const reader = createSpawnedReader({
    now: () => now,
    rootPid: OUR_PID,
    chromiumPids: () => CHROMIUM,
    read: (done) => {
      pending.push(done)
    },
  })
  return {
    reader,
    later: () => {
      now += 30_000
    },
    succeed: (table = LISTING) => pending.shift()?.(null, table),
    fail: () => pending.shift()?.(new Error('ps died'), ''),
  }
}

describe('§3 · createSpawnedReader leaves out its own ps and says whether it has read', () => {
  it('§3 · a ps straight under our pid is ours and left out; one under an agent stays', () => {
    const r = aReader()
    r.reader.refresh()
    r.succeed()
    const pids = r.reader
      .snapshot()
      .map((one) => one.pid)
      .sort((a, b) => a - b)
    expect(pids).not.toContain(610)
    // The agent's own `ps` is a command the agent runs, and is the agent's.
    expect(pids).toContain(620)
    // Only a process named exactly `ps` is the probe.
    expect(pids).toContain(640)
    expect(pids).toEqual([600, 620, 630, 640])
  })

  it('§3 · everRead is false until a reading lands, and a failed one is still a reading', () => {
    const r = aReader()
    expect(r.reader.everRead()).toBe(false)
    r.reader.refresh()
    // In flight: still nothing read, and the empty snapshot says nothing.
    expect(r.reader.everRead()).toBe(false)
    expect(r.reader.snapshot()).toEqual([])
    r.fail()
    expect(r.reader.everRead()).toBe(true)
    expect(r.reader.failed()).toBe(true)
  })

  it('§3 · read and found none is told apart from not read yet', () => {
    const fresh = aReader()
    const bare = aReader()
    bare.reader.refresh()
    bare.succeed('  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2')
    // Both snapshots are empty; only one of them was read.
    expect(fresh.reader.snapshot()).toEqual([])
    expect(bare.reader.snapshot()).toEqual([])
    expect(fresh.reader.everRead()).toBe(false)
    expect(bare.reader.everRead()).toBe(true)
    expect(bare.reader.failed()).toBe(false)
  })

  it('§3 · a listing whose only spawned process is our own probe finds none', () => {
    const r = aReader()
    r.reader.refresh()
    r.succeed(
      [
        '  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2',
        '  610   500    1200 /bin/ps',
      ].join('\n'),
    )
    // Before the probe was left out, this read as one agent, and "None of its agents is running."
    // could never be said.
    expect(r.reader.snapshot()).toEqual([])
    expect(whatItsAgentsHoldApart(r.reader.snapshot())).toBe('None of its agents is running.')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §4 · the app's own line no longer fires on its agents' climb
// ═════════════════════════════════════════════════════════════════════════════════════════════

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

/** From a marker that is in the source exactly once, to (not including) the first `closing` after it. */
function sliceOf(marker: string, closing: string, source: string): string {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in main/index.ts`).toBeGreaterThan(-1)
  expect(source.indexOf(marker, at + 1), `${marker} is in main/index.ts twice`).toBe(-1)
  const end = source.indexOf(closing, at)
  expect(end, `${marker} is never closed by ${JSON.stringify(closing)}`).toBeGreaterThan(at)
  return source.slice(at, end)
}

describe("§4 · the app's own line counts the app itself, and says its agents apart", () => {
  it('§4 · agents climbing to 7 GB write no app line; the window growing does, with the agents apart', () => {
    // Composed as `index.ts` composes it: the sample is the app's own metrics; the detail is that
    // same reading's breakdown, then the agents from the reader's last listing.
    let metrics: OwnProcess[] = [own('Browser', 300), own('Tab', 200)]
    let agentsKb = 7 * 1024 * 1024 // node, in ps's kilobytes
    const reader = createSpawnedReader({
      now: () => 1_000,
      rootPid: OUR_PID,
      chromiumPids: () => CHROMIUM,
      read: (done) =>
        done(
          null,
          [
            '  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2',
            '  600   500  400000 /Users/x/.local/bin/claude',
            `  630   600 ${agentsKb} /usr/local/bin/node`,
          ].join('\n'),
        ),
    })
    let itself = whatTheAppItselfHolds([])
    const logs: string[] = []
    const registered: (() => void)[] = []
    const watch = startMemoryWatch({
      sample: () => {
        reader.refresh()
        itself = whatTheAppItselfHolds(metrics)
        return itself.bytes
      },
      detail: () =>
        `[${itself.said}] ${whatItsAgentsHoldApart(
          !reader.everRead() ? 'not-read-yet' : reader.failed() ? 'unreadable' : reader.snapshot(),
        )}`,
      log: (message) => logs.push(message),
      setInterval: (fn) => {
        registered.push(fn)
        return 1
      },
      clearInterval: () => {},
    })
    const tick = registered[0]
    expect(tick).toBeDefined()

    // The agents at 7 GB and more, the app at half a gigabyte: the line the old total wrote.
    tick?.()
    agentsKb = 9 * 1024 * 1024
    tick?.()
    expect(reader.snapshot().length).toBeGreaterThan(0)
    expect(logs).toEqual([])

    // Paired: the window itself grows past the floor, and the line is written once, about it.
    metrics = [own('Browser', 300), own('Tab', 2662)]
    tick?.()
    watch.stop()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('BroCrew itself')
    expect(logs[0]).toContain('is holding 2.89 GB')
    expect(logs[0]).toContain('[main:0.29GB window:2.60GB]')
    expect(logs[0]).toContain('Apart from this, its agents and the commands they run hold 9.38 GB')
    expect(logs[0]).toContain('[node:9.00GB claude:0.38GB]')
  })

  const main = code('main/index.ts', readFileSync(join(here, '../src/main/index.ts'), 'utf8'))
  const appsLine = sliceOf('let itself = whatTheAppItselfHolds([])', 'const agentsFloor', main)

  it("§4 · index.ts: the app's line samples the app's own metrics and never its agents", () => {
    const from = appsLine.indexOf('sample: () => {')
    expect(from).toBeGreaterThan(-1)
    const sample = appsLine.slice(from, appsLine.indexOf('detail:', from))
    // The slice found the sample before any negative is asked of it.
    expect(sample).toContain('spawnedReader.refresh()')
    expect(sample).toContain('itself = whatTheAppItselfHolds(app.getAppMetrics())')
    expect(sample).toContain('return itself.bytes')
    // ⛔ The agents' figure is never added to what the floor is held against.
    expect(sample).not.toContain('totalBytes(')
    expect(sample).not.toContain('snapshot()')
  })

  it("§4 · index.ts: the breakdown is the counted reading, and the agents' three states are told apart", () => {
    const from = appsLine.indexOf('detail:')
    expect(from).toBeGreaterThan(-1)
    const detail = appsLine.slice(from, appsLine.indexOf('log:', from))
    expect(detail).toContain('`[${itself.said}] ${whatItsAgentsHoldApart(')
    // One reading of the metrics in the whole app line: the breakdown never reads them again.
    expect(appsLine.match(/getAppMetrics\(\)/g)).toHaveLength(1)
    expect(detail).not.toContain('getAppMetrics')
    // Not read yet is asked first, then a failure, then the listing.
    const notYet = detail.indexOf('!spawnedReader.everRead()')
    const failed = detail.indexOf('spawnedReader.failed()')
    const listing = detail.indexOf('spawnedReader.snapshot()')
    expect(notYet).toBeGreaterThan(-1)
    expect(failed).toBeGreaterThan(notYet)
    expect(listing).toBeGreaterThan(failed)
    expect(detail.indexOf("'not-read-yet'")).toBeGreaterThan(notYet)
    expect(detail.indexOf("'unreadable'")).toBeGreaterThan(failed)
  })
})
