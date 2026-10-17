import { spawn } from 'node:child_process'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  endingsOf,
  endTree,
  ENDING_RESERVE_MS,
  fileTimeOf,
  isRunning,
  parseReading,
  parseTable,
  readTable,
  startEnder,
  treeOf,
  type Ender,
  type KnownRow,
  type TableReading,
  type TableRow,
  type TreeEnding,
} from '../src/codex/windows-tree'

/**
 * On Windows the processes a Codex app-server started are found in the process table: under the
 * number of the parent that started them, which they keep after it exits, and created no earlier
 * than it. A number reused since is told apart by when its process was created.
 */

const SECOND = 10_000_000n
const STARTED = fileTimeOf(Date.UTC(2026, 9, 16, 4, 0, 0))
const row = (pid: number, ppid: number, after: bigint): TableRow => ({
  pid,
  ppid,
  created: STARTED + after,
})

describe('the process table', () => {
  it('is read a line at a time, and what is not three whole numbers is skipped', () => {
    expect(parseTable('4 0 0\r\n4101 900 133800000000000000\r\nnot a line\r\n1 2\r\n')).toEqual([
      { pid: 4, ppid: 0, created: 0n },
      { pid: 4101, ppid: 900, created: 133_800_000_000_000_000n },
    ])
  })

  it('counts time from 1601 in 100-nanosecond steps', () => {
    expect(fileTimeOf(0)).toBe(116_444_736_000_000_000n)
  })
})

describe('the tree an app-server started', () => {
  const leader = row(4101, 900, SECOND)
  const child = row(4102, 4101, 2n * SECOND)
  const grandchild = row(4103, 4102, 3n * SECOND)
  const stranger = row(5000, 900, 2n * SECOND)

  it('🔴 while it runs: itself, its children and theirs, and nothing else', () => {
    const tree = treeOf([leader, child, grandchild, stranger], {
      pid: 4101,
      startedAt: STARTED,
      endedAt: null,
    })
    expect(tree.map((one) => one.pid).sort()).toEqual([4101, 4102, 4103])
  })

  it('🔴 after it exited: what it started, still found under its number', () => {
    const tree = treeOf([child, grandchild, stranger], {
      pid: 4101,
      startedAt: STARTED,
      endedAt: STARTED + 5n * SECOND,
    })
    expect(tree.map((one) => one.pid).sort()).toEqual([4102, 4103])
  })

  it('⛔ a number reused after it exited, and what that started, are not its own', () => {
    const reused = row(4101, 777, 60n * SECOND)
    const reusedChild = row(4200, 4101, 61n * SECOND)
    const tree = treeOf([child, reused, reusedChild], {
      pid: 4101,
      startedAt: STARTED,
      endedAt: STARTED + 5n * SECOND,
    })
    expect(tree.map((one) => one.pid)).toEqual([4102])
  })

  it('⛔ a process older than the parent it names is not its child', () => {
    const older = row(4300, 4101, -60n * SECOND)
    const tree = treeOf([leader, older], { pid: 4101, startedAt: STARTED, endedAt: null })
    expect(tree.map((one) => one.pid)).toEqual([4101])
  })

  it('a tree with nothing left running is empty', () => {
    expect(
      treeOf([stranger], { pid: 4101, startedAt: STARTED, endedAt: STARTED + 5n * SECOND }),
    ).toEqual([])
  })
})

describe('what an earlier reading found', () => {
  const launcher = row(4102, 4101, 2n * SECOND)
  const program = row(4103, 4102, 3n * SECOND)
  const stranger = row(5000, 900, 2n * SECOND)
  const exited = { pid: 4101, startedAt: STARTED, endedAt: STARTED + 5n * SECOND }
  /** The launcher as a reading saw it running, after it had started the program. */
  const seenLauncher = { ...launcher, seenAt: STARTED + 4n * SECOND }

  it('🔴 a program whose launcher has exited is found under the launcher an earlier reading saw', () => {
    expect(treeOf([program, stranger], exited)).toEqual([])
    expect(treeOf([program, stranger], exited, [seenLauncher])).toEqual([program])
  })

  it('🔴 under a number a stranger took after the launcher was last seen, the stranger’s child is not ours', () => {
    // The stranger took 4102 after the reading, started a child, and has exited too.
    const strangersChild = row(4300, 4102, 61n * SECOND)
    const tree = treeOf([program, strangersChild], exited, [seenLauncher])
    expect(tree.map((one) => one.pid)).toEqual([4103])
  })

  it('…and a program the launcher started after the last reading that saw it is not counted either', () => {
    const later = row(4104, 4102, 4n * SECOND + 1n)
    expect(treeOf([later], exited, [seenLauncher])).toEqual([])
  })

  it('a process an earlier reading found that still runs is in the tree, with all it started', () => {
    const late = row(4105, 4102, 30n * SECOND)
    const tree = treeOf([launcher, late, stranger], exited, [seenLauncher])
    expect(tree).toEqual([launcher, late])
  })
})

describe('a reading', () => {
  it('says when it was taken, and a reading without a time is none', () => {
    expect(parseReading('at 133800000000000000\r\n4101 900 133800000000000001\r\n')).toEqual({
      at: 133_800_000_000_000_000n,
      rows: [{ pid: 4101, ppid: 900, created: 133_800_000_000_000_001n }],
    })
    expect(parseReading('4101 900 133800000000000001\r\n')).toBeNull()
  })
})

describe('what an ender says', () => {
  it('reads one answer per process, and a process not answered for as failed', () => {
    const one = row(4102, 4101, SECOND)
    const two = row(4103, 4101, SECOND)
    const said = endingsOf(`ended ${String(one.pid)}:${String(one.created)}\r\nnoise\r\n`, [
      one,
      two,
    ])
    expect([...said.values()]).toEqual(['ended', 'failed'])
  })
})

/** A tree to end, with a fake system: what was ended, dismissed and warned is kept. */
function aTreeToEnd(over: {
  readonly read: (ms: number) => Promise<TableReading | null>
  readonly known?: readonly KnownRow[]
  readonly running: Set<number>
  readonly leaderStays?: boolean
  readonly budgetMs: number
}) {
  const said = {
    ended: [] as TableRow[],
    dismissed: false,
    leaderEnded: false,
    warnings: [] as string[],
  }
  let endedAt: bigint | null = null
  let exit!: () => void
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  const leaderStops = (): void => {
    endedAt = STARTED + 5n * SECOND
    over.running.delete(4101)
    exit()
  }
  if (over.leaderStays !== true) leaderStops()
  const ender: Ender = {
    end: (rows) => {
      said.ended.push(...rows)
      for (const one of rows) over.running.delete(one.pid)
      return Promise.resolve(
        endingsOf(
          rows.map((one) => `ended ${String(one.pid)}:${String(one.created)}`).join('\n'),
          rows,
        ),
      )
    },
    dismiss: () => {
      said.dismissed = true
    },
  }
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const ending: TreeEnding = {
    leader: { pid: 4101, startedAt: STARTED },
    leaderEndedAt: () => endedAt,
    awaitLeader: (ms) => Promise.race([exited.then(() => true), sleep(ms).then(() => false)]),
    endLeader: () => {
      said.leaderEnded = true
      leaderStops()
    },
    known: () => over.known ?? [],
    remember: () => {},
    read: over.read,
    startEnder: () => ender,
    isRunning: (pid) => over.running.has(pid),
    now: () => Date.now(),
    sleep,
    graceMs: 300,
    killGraceMs: 300,
    budgetMs: over.budgetMs,
    warn: (line) => {
      said.warnings.push(line)
    },
  }
  return { ending, said }
}

describe('ending a tree within its budget', () => {
  const leaderRow = row(4101, 900, SECOND)
  const child = row(4102, 4101, 2n * SECOND)
  const seenChild = { ...child, seenAt: STARTED + 4n * SECOND }
  const budgetMs = ENDING_RESERVE_MS + 500
  const reading = (...rows: TableRow[]): Promise<TableReading> =>
    Promise.resolve({ at: STARTED + 6n * SECOND, rows })

  it('🔴 a table that does not answer: what earlier readings found is ended, within the budget', async () => {
    const { ending, said } = aTreeToEnd({
      read: () => new Promise(() => {}),
      known: [seenChild],
      running: new Set([4102]),
      budgetMs,
    })
    const started = Date.now()

    await endTree(ending)

    expect(Date.now() - started).toBeLessThan(budgetMs)
    expect(said.ended).toEqual([seenChild])
    expect(said.warnings.join(' ')).toContain('not read in time')
  })

  it('🔴 every process is ended by number and creation time, and the app-server through its own handle', async () => {
    const { ending, said } = aTreeToEnd({
      read: () => reading(leaderRow, child),
      running: new Set([4101, 4102]),
      leaderStays: true,
      budgetMs,
    })

    await endTree(ending)

    expect(said.leaderEnded).toBe(true)
    expect(said.ended).toEqual([child])
    expect(said.warnings).toEqual([])
  })

  it('🔴 a program whose launcher has exited is ended with the tree', async () => {
    const program = row(4103, 4102, 3n * SECOND)
    const { ending, said } = aTreeToEnd({
      read: () => reading(program),
      known: [seenChild],
      running: new Set([4103]),
      budgetMs,
    })

    await endTree(ending)

    expect(said.ended).toEqual([program])
  })

  it('nothing left running: nothing is ended, and the ender is let go', async () => {
    const { ending, said } = aTreeToEnd({
      read: () => reading(leaderRow),
      running: new Set(),
      budgetMs,
    })
    const started = Date.now()

    await endTree(ending)

    expect(said.ended).toEqual([])
    expect(said.dismissed).toBe(true)
    expect(Date.now() - started).toBeLessThan(200)
  })
})

describe.runIf(process.platform === 'win32')(
  'ending a real process by number and creation time',
  () => {
    it('🔴 a number another process holds now is left alone; the process found is ended', async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      })
      onTestFinished(() => {
        child.kill()
      })
      const pid = child.pid!
      const found = (await readTable(15_000))?.rows.find((one) => one.pid === pid)
      expect(found, 'the process must be in the table').toBeDefined()
      // As if its number had been reused since: the same number, a process created a second later.
      const reused = { ...found!, created: found!.created + SECOND }

      expect([...(await startEnder().end([reused], 5_000)).values()]).toEqual(['another'])
      expect(isRunning(pid), 'a process was ended by its number alone').toBe(true)

      expect([...(await startEnder().end([found!], 5_000)).values()]).toEqual(['ended'])
      expect(isRunning(pid)).toBe(false)
    }, 60_000)
  },
)
