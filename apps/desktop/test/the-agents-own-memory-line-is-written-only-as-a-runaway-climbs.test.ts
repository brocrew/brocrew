import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AGENTS_MEMORY_FLOOR_BYTES,
  AGENTS_MEMORY_STEP_BYTES,
  agentsMemoryFloorFor,
  startMemoryWatch,
  theAgentsDetail,
  theAgentsHeadline,
  theAppItselfHeadline,
  type MemoryWatchOptions,
} from '../src/main/memory-watch'
import {
  parseProcessTable,
  spawnedDescendants,
  type SpawnedProcess,
} from '../src/main/process-tree'
import { proseSpans } from './lib/prose-spans'

/**
 * # The agents' own memory line, written only as a runaway climbs (aab65c9c)
 *
 * ⚑ Since a5030808 the app's line counts BroCrew itself, so an agent — or a command it runs — that
 * alone climbed to many gigabytes wrote nothing. The agents' total now writes a line of its own past
 * 16 GiB (or three quarters of the machine where that is less), then each further 4 GiB, and begins
 * again once an episode ends; it names the agents holding the most.
 *
 *  - **§1** the floor on this machine.
 *  - **§2** the watch as `index.ts` shapes it for the agents: silent below its floor, once per
 *    4 GiB step, begun again below floor − step, its own headline, and apart from the app's line.
 *  - **§3** whose each process is (`SpawnedProcess.head`), and the line's detail naming the most.
 *  - **§4** the wiring in `index.ts`, read as source.
 */

const here = dirname(fileURLToPath(import.meta.url))
const MiB = 1024 ** 2
const GiB = 1024 ** 3

type Shape = Omit<MemoryWatchOptions, 'sample' | 'log' | 'setInterval' | 'clearInterval'>

/** Feed a watch one reading per tick, driven by hand; return what it wrote and how often it asked for detail. */
function drive(samples: readonly number[], shape: Shape = {}): { logs: string[]; asked: number } {
  const queue = [...samples]
  const logs: string[] = []
  let asked = 0
  const registered: (() => void)[] = []
  const watch = startMemoryWatch({
    ...shape,
    ...(shape.detail === undefined
      ? {}
      : {
          detail: () => {
            asked += 1
            return shape.detail?.() ?? ''
          },
        }),
    sample: () => queue.shift() ?? 0,
    log: (message) => logs.push(message),
    setInterval: (fn) => {
      registered.push(fn)
      return 1
    },
    clearInterval: () => {},
  })
  const tick = registered[0]
  expect(tick, 'the watch must register a timer').toBeDefined()
  for (let i = 0; i < samples.length; i++) tick?.()
  watch.stop()
  return { logs, asked }
}

/** The agents' watch as `index.ts` shapes it, on a machine of `machine` bytes. */
const agentsOn = (machine: number): Shape => {
  const floor = agentsMemoryFloorFor(machine)
  return {
    floorBytes: floor,
    stepBytes: AGENTS_MEMORY_STEP_BYTES,
    rearmBelowBytes: floor - AGENTS_MEMORY_STEP_BYTES,
    headline: theAgentsHeadline,
  }
}
const AGENTS = agentsOn(64 * GiB)

/** The figure on each line, in GB as written. */
const figures = (logs: readonly string[]): string[] =>
  logs.map((line) => /holding (\d+\.\d\d) GB/.exec(line)?.[1] ?? '?')

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §1 · the floor
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§1 · agentsMemoryFloorFor', () => {
  it('§1 · 16 GiB on a machine with room, three quarters of a smaller one', () => {
    expect(agentsMemoryFloorFor(64 * GiB)).toBe(16 * GiB)
    expect(agentsMemoryFloorFor(32 * GiB)).toBe(16 * GiB)
    expect(agentsMemoryFloorFor(64 * GiB)).toBe(AGENTS_MEMORY_FLOOR_BYTES)
    // Paired: where three quarters of the machine is less than 16 GiB, that is the floor — `ps`
    // never sees what is compressed or swapped, so a 16 GB Mac could never show 16 GiB.
    expect(agentsMemoryFloorFor(16 * GiB)).toBe(12 * GiB)
    expect(agentsMemoryFloorFor(8 * GiB)).toBe(6 * GiB)
  })

  it('§1 · always a whole number of bytes', () => {
    const odd = agentsMemoryFloorFor(16 * GiB + 3)
    expect(Number.isInteger(odd)).toBe(true)
    expect(odd).toBe(12 * GiB + 2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §2 · the agents' own watch
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("§2 · the agents' own watch", () => {
  it('§2 · says nothing at what a team running its test suites reaches', () => {
    // The highest agents' total in sixteen days of team use was about 9.7 GB.
    const quiet = drive([1.5 * GiB, 6.7 * GiB, 9.7 * GiB, 12 * GiB, 15.9 * GiB], AGENTS)
    expect(quiet.logs).toEqual([])
    // Paired: the same readings through the app's own floor would have written a line each GiB.
    expect(drive([1.5 * GiB, 6.7 * GiB, 9.7 * GiB, 12 * GiB, 15.9 * GiB]).logs).toHaveLength(4)
  })

  it('§2 · writes once on crossing its floor, in its own words', () => {
    const { logs } = drive([15.9 * GiB, 16 * GiB, 17 * GiB, 19.9 * GiB], AGENTS)
    expect(figures(logs)).toEqual(['16.00'])
    expect(logs[0]).toBe(theAgentsHeadline(16 * GiB))
    expect(logs[0]).toContain(
      "[memory] BroCrew's agents and the commands they run are holding 16.00 GB",
    )
    // Never the app's own sentence.
    expect(logs[0]).not.toContain('BroCrew itself — its main process')
    expect(theAgentsHeadline(16 * GiB)).not.toBe(theAppItselfHeadline(16 * GiB))
  })

  it('§2 · writes again each further 4 GiB, and not each gigabyte', () => {
    const { logs } = drive(
      [16.5 * GiB, 17.5 * GiB, 18.5 * GiB, 20.1 * GiB, 21 * GiB, 24 * GiB, 30 * GiB],
      AGENTS,
    )
    // 17.5 and 18.5 are past a gigabyte step and not past a 4 GiB one; 21 is inside 20–24; 30 is
    // past 28.
    expect(figures(logs)).toEqual(['16.50', '20.10', '24.00', '30.00'])
  })

  it('§2 · begins again once the figure falls below floor − step, and not on a dip above it', () => {
    // Fell to 11.9 GiB, below 12: that episode ended, and the next climb is new.
    expect(figures(drive([17 * GiB, 11.9 * GiB, 17 * GiB], AGENTS).logs)).toEqual([
      '17.00',
      '17.00',
    ])
    // A dip to 12.5, and to exactly 12, is the same episode.
    expect(figures(drive([17 * GiB, 12.5 * GiB, 17 * GiB], AGENTS).logs)).toEqual(['17.00'])
    expect(figures(drive([17 * GiB, 12 * GiB, 17 * GiB], AGENTS).logs)).toEqual(['17.00'])
    // The dip does not reset the steps above it either: 20.5 crosses 20 for the first time.
    expect(figures(drive([17 * GiB, 13 * GiB, 20.5 * GiB], AGENTS).logs)).toEqual([
      '17.00',
      '20.50',
    ])
  })

  it("§2 · the app's own line never begins again, however far it falls", () => {
    // Left out for the app itself: one process whose climb is one episode for its life.
    expect(figures(drive([2.1 * GiB, 0.5 * GiB, 2.1 * GiB]).logs)).toEqual(['2.10'])
    // Paired: the same fall with a rearm floor is a new episode.
    expect(
      figures(drive([2.1 * GiB, 0.5 * GiB, 2.1 * GiB], { rearmBelowBytes: GiB }).logs),
    ).toEqual(['2.10', '2.10'])
  })

  it('§2 · on a 16 GB Mac the floor is 12 GiB, and begins again below 8', () => {
    const small = agentsOn(16 * GiB)
    expect(figures(drive([11.9 * GiB, 12.1 * GiB, 15.9 * GiB, 16.2 * GiB], small).logs)).toEqual([
      '12.10',
      '16.20',
    ])
    expect(figures(drive([12.5 * GiB, 7.9 * GiB, 12.5 * GiB], small).logs)).toEqual([
      '12.50',
      '12.50',
    ])
    expect(figures(drive([12.5 * GiB, 8 * GiB, 12.5 * GiB], small).logs)).toEqual(['12.50'])
  })

  it('§2 · asks for the agents’ names only when it writes', () => {
    const { logs, asked } = drive([9 * GiB, 15 * GiB, 16.5 * GiB, 17 * GiB, 18 * GiB], {
      ...AGENTS,
      detail: () => 'Holding the most: Ada holds 16.00 GB. BroCrew itself holds 0.59 GB.',
    })
    expect(asked).toBe(1)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toBe(
      `${theAgentsHeadline(16.5 * GiB)} Holding the most: Ada holds 16.00 GB. BroCrew itself holds 0.59 GB.`,
    )
  })

  it("§2 · the agents' line and the app's line keep their own count", () => {
    // Two watches, ticked together as `index.ts` runs them: each has its own floor, steps and
    // episode, so one writing says nothing about the other.
    const appLogs: string[] = []
    const agentLogs: string[] = []
    const ticks: (() => void)[] = []
    const sampled = { app: 0.6 * GiB, agents: 6 * GiB }
    const register = (fn: () => void): number => ticks.push(fn)
    const app = startMemoryWatch({
      sample: () => sampled.app,
      log: (message) => appLogs.push(message),
      setInterval: register,
      clearInterval: () => {},
    })
    const agents = startMemoryWatch({
      ...AGENTS,
      sample: () => sampled.agents,
      log: (message) => agentLogs.push(message),
      setInterval: register,
      clearInterval: () => {},
    })
    expect(ticks).toHaveLength(2)
    const both = (): void => ticks.forEach((tick) => tick())

    both()
    sampled.agents = 26 * GiB // the incident's figure, the agents' alone
    both()
    expect(figures(agentLogs)).toEqual(['26.00'])
    expect(appLogs).toEqual([])

    sampled.agents = 9 * GiB
    sampled.app = 2.1 * GiB // now the app itself grows, the agents at a test run's figure
    both()
    expect(figures(appLogs)).toEqual(['2.10'])
    expect(appLogs[0]).toContain('BroCrew itself')
    expect(figures(agentLogs)).toEqual(['26.00'])

    app.stop()
    agents.stop()
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §3 · whose each process is, and the detail naming the most
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('§3 · spawnedDescendants says whose each process is', () => {
  /** Synthetic: two agents straight under ours, and a command under a Chromium utility. */
  const rows = parseProcessTable(
    [
      '  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2',
      '  501   500  110000 /Applications/BroBot2.app/Contents/Frameworks/Electron Helper (Renderer)',
      '  503   500   38000 /Applications/BroBot2.app/Contents/Frameworks/Electron Helper',
      '  600   500  400000 /Users/x/.local/bin/claude',
      '  601   600  900000 /usr/local/bin/node',
      '  602   601  800000 /Users/x/chrome-headless-shell',
      '  700   500  300000 /Users/x/.local/bin/claude',
      '  800   503   90000 /usr/bin/node',
      '  801   800   10000 /usr/local/bin/rg',
    ].join('\n'),
  )
  const spawned = spawnedDescendants(rows, 500, new Set([500, 501, 503]))
  const headOf = (pid: number): number | undefined => spawned.find((one) => one.pid === pid)?.head

  it('§3 · one we started heads itself; the commands it runs, to any depth, are its', () => {
    expect(headOf(600)).toBe(600)
    expect(headOf(700)).toBe(700)
    expect(headOf(601)).toBe(600)
    expect(headOf(602)).toBe(600)
    // Paired: the other agent's process is not the first's.
    expect(headOf(700)).not.toBe(600)
  })

  it('§3 · under a Chromium process a command heads its own subtree, never the Chromium one', () => {
    expect(headOf(800)).toBe(800)
    expect(headOf(801)).toBe(800)
    expect(spawned.map((one) => one.head)).not.toContain(503)
    expect(spawned.map((one) => one.head)).not.toContain(500)
  })
})

describe('§3 · theAgentsDetail names the agents holding the most', () => {
  const one = (pid: number, head: number, name: string, gib: number): SpawnedProcess => ({
    pid,
    head,
    name,
    rssBytes: gib * GiB,
  })
  /** Five agents, interleaved as a listing would give them. B 8.5, A 6.75, C 1.5, D and E 0.25. */
  const SPAWNED: readonly SpawnedProcess[] = [
    one(600, 600, 'claude', 0.5),
    one(700, 700, 'claude', 0.5),
    one(601, 600, 'node', 3),
    one(800, 800, 'node', 1.5),
    one(602, 600, 'chrome-headless-shell', 2),
    one(701, 700, 'node', 8),
    one(900, 900, 'claude', 0.25),
    one(603, 600, 'node', 1),
    one(950, 950, 'claude', 0.25),
    one(604, 600, 'rg', 0.25),
  ]
  const ITSELF = 600 * MiB

  /** A namer that knows two of the agents, and records which heads it was asked for. */
  function namer(): {
    asked: number[][]
    nameThem: (heads: readonly number[]) => ReadonlyMap<number, string>
  } {
    const asked: number[][] = []
    return {
      asked,
      nameThem: (heads) => {
        asked.push([...heads])
        return new Map([
          [700, 'Ada (the owner of W1.2 · Build the pages)'],
          [600, 'Ben'],
          [900, 'Cleo'],
        ])
      },
    }
  }

  it('§3 · the largest three by agent, each with its largest processes and the rest counted', () => {
    const n = namer()
    expect(theAgentsDetail(SPAWNED, n.nameThem, ITSELF)).toBe(
      'Holding the most: ' +
        'Ada (the owner of W1.2 · Build the pages) holds 8.50 GB (node 8.00 GB, claude 0.50 GB); ' +
        'Ben holds 6.75 GB (node 3.00 GB, chrome-headless-shell 2.00 GB, node 1.00 GB, and 2 more 0.75 GB); ' +
        'a process BroCrew started (node) holds 1.50 GB (node 1.50 GB); ' +
        '2 more hold 0.50 GB. ' +
        'BroCrew itself holds 0.59 GB.',
    )
    // Asked once, for the three it names and in their order — never for the ones it does not.
    expect(n.asked).toEqual([[700, 600, 800]])
    expect(n.asked.flat()).not.toContain(900)
  })

  it('§3 · one left over holds; a smaller limit names fewer and counts the rest', () => {
    const fourAgents = SPAWNED.filter((p) => p.head !== 950)
    expect(theAgentsDetail(fourAgents, namer().nameThem, ITSELF)).toContain(
      '; 1 more holds 0.25 GB. ',
    )
    const n = namer()
    const line = theAgentsDetail(SPAWNED, n.nameThem, ITSELF, 1)
    expect(n.asked).toEqual([[700]])
    expect(line).toBe(
      'Holding the most: Ada (the owner of W1.2 · Build the pages) holds 8.50 GB ' +
        '(node 8.00 GB, claude 0.50 GB); 4 more hold 8.75 GB. BroCrew itself holds 0.59 GB.',
    )
    expect(line).not.toContain('Ben')
  })

  it('§3 · a group whose own process is gone is named as unnamed', () => {
    const line = theAgentsDetail(
      [one(1201, 1200, 'node', 1)],
      () => new Map<number, string>(),
      ITSELF,
    )
    expect(line).toBe(
      'Holding the most: a process BroCrew started (unnamed) holds 1.00 GB (node 1.00 GB). ' +
        'BroCrew itself holds 0.59 GB.',
    )
  })

  it('§3 · no agents: only what the app itself holds, and nobody is asked for a name', () => {
    const n = namer()
    expect(theAgentsDetail([], n.nameThem, ITSELF)).toBe('BroCrew itself holds 0.59 GB.')
    expect(n.asked).toEqual([])
    // Paired: one agent, and the namer is asked once.
    theAgentsDetail([one(600, 600, 'claude', 0.5)], n.nameThem, ITSELF)
    expect(n.asked).toEqual([[600]])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════
// §4 · the wiring in index.ts
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

function sliceOf(marker: string, closing: string, source: string): string {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in main/index.ts`).toBeGreaterThan(-1)
  expect(source.indexOf(marker, at + 1), `${marker} is in main/index.ts twice`).toBe(-1)
  const end = source.indexOf(closing, at)
  expect(end, `${marker} is never closed by ${JSON.stringify(closing)}`).toBeGreaterThan(at)
  return source.slice(at, end)
}

describe("§4 · index.ts runs the agents' own line", () => {
  const main = code('main/index.ts', readFileSync(join(here, '../src/main/index.ts'), 'utf8'))
  const agentsLine = sliceOf(
    'const agentsFloor = agentsMemoryFloorFor(totalmem())',
    '}, AGENTS_LINE_LAG_MS).unref()',
    main,
  )
  const appsLine = sliceOf('let itself = whatTheAppItselfHolds([])', 'const agentsFloor', main)

  it("§4 · its floor, steps, episode and words are the agents' own", () => {
    expect(agentsLine).toContain('startMemoryWatch({')
    expect(agentsLine).toContain('floorBytes: agentsFloor,')
    expect(agentsLine).toContain('stepBytes: AGENTS_MEMORY_STEP_BYTES,')
    expect(agentsLine).toContain('rearmBelowBytes: agentsFloor - AGENTS_MEMORY_STEP_BYTES,')
    expect(agentsLine).toContain('headline: theAgentsHeadline,')
    // Paired: the app's own line takes none of them — its defaults, and one episode for its life.
    expect(appsLine).toContain('startMemoryWatch({')
    expect(appsLine).not.toMatch(/\b(floorBytes|stepBytes|rearmBelowBytes|headline):/)
  })

  it('§4 · it counts the last listing only once one was read and did not fail, and starts none', () => {
    const from = agentsLine.indexOf('sample: () =>')
    expect(from).toBeGreaterThan(-1)
    const sample = agentsLine.slice(from, agentsLine.indexOf('detail:', from))
    expect(sample).toContain('spawnedReader.everRead() && !spawnedReader.failed()')
    expect(sample).toContain('totalBytes(spawnedReader.snapshot())')
    expect(sample).toMatch(/:\s*0,?\s*$/)
    // ⛔ No listing of its own: the app's line starts the one listing each tick.
    expect(agentsLine).not.toContain('spawnedReader.refresh()')
    expect(appsLine).toContain('spawnedReader.refresh()')
    expect(agentsLine).not.toContain('getAppMetrics')
  })

  it("§4 · it names the agents through the host, beside the app itself's last reading", () => {
    const from = agentsLine.indexOf('detail: () =>')
    expect(from).toBeGreaterThan(-1)
    const detail = agentsLine.slice(from, agentsLine.indexOf('log:', from))
    expect(detail).toContain('theAgentsDetail(')
    expect(detail).toContain('host?.whoseAgentsAre(heads)')
    expect(detail).toContain('itself.bytes')
    // Both lines write to the same log.
    expect(agentsLine).toContain('log: intoTheMemoryLog,')
    expect(appsLine).toContain('log: intoTheMemoryLog,')
  })
})
