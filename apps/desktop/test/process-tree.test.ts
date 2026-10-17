import { describe, expect, it } from 'vitest'
import {
  createSpawnedReader,
  describeSpawned,
  parseProcessTable,
  spawnedDescendants,
  totalBytes,
  type ProcessRow,
} from '../src/main/process-tree'

/**
 * A `ps -axo pid=,ppid=,rss=,comm=` listing, in the shape macOS actually emits it: leading spaces
 * for right-aligned pids, full executable paths, and one command containing spaces and parentheses.
 *
 * Synthetic. Nothing here is from a real session or a real machine's process list.
 */
const PS_OUTPUT = [
  '    1     0   12000 /sbin/launchd',
  '  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2',
  '  501   500  110000 /Applications/BroBot2.app/Contents/Frameworks/Electron Helper (Renderer)',
  '  502   500   74000 /Applications/BroBot2.app/Contents/Frameworks/Electron Helper (GPU)',
  '  503   500   38000 /Applications/BroBot2.app/Contents/Frameworks/Electron Helper',
  '  600   500 1250000 /Users/x/node_modules/@openai/codex/vendor/bin/codex',
  '  601   600  640000 /usr/local/bin/rg',
  '  700   503   90000 /usr/bin/node',
  '  900     1  400000 /Applications/SomethingElse.app/Contents/MacOS/SomethingElse',
].join('\n')

/** The pids `app.getAppMetrics()` would report: the Electron main process and its Chromium children. */
const CHROMIUM_PIDS = new Set([500, 501, 502, 503])
const OUR_PID = 500

const KB = 1024

describe('parseProcessTable', () => {
  it('keeps a command that contains spaces and parentheses', () => {
    const rows = parseProcessTable(PS_OUTPUT)
    const renderer = rows.find((r) => r.pid === 501)
    expect(renderer?.name).toBe('Electron Helper (Renderer)')
  })

  it('reads rss as kilobytes, because that is what ps reports', () => {
    const codex = parseProcessTable(PS_OUTPUT).find((r) => r.pid === 600)
    expect(codex?.rssBytes).toBe(1_250_000 * KB)
  })

  it('takes the basename, so the line names something a human can act on', () => {
    const names = parseProcessTable(PS_OUTPUT).map((r) => r.name)
    expect(names).toContain('codex')
    expect(names).toContain('rg')
    expect(names).not.toContain('/Users/x/node_modules/@openai/codex/vendor/bin/codex')
  })

  it('skips a line it cannot read rather than losing the listing', () => {
    // A process can exit while ps is writing; the row arrives truncated. One bad row must not
    // cost us the other several hundred.
    const rows = parseProcessTable(`${PS_OUTPUT}\n  garbage\n\n  777`)
    expect(rows.map((r) => r.pid)).toContain(600)
    expect(rows.some((r) => Number.isNaN(r.pid))).toBe(false)
  })
})

describe('spawnedDescendants', () => {
  const rows = parseProcessTable(PS_OUTPUT)

  it('finds the agent Chromium cannot see', () => {
    const spawned = spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS)
    const codex = spawned.find((p) => p.name === 'codex')
    expect(codex).toBeDefined()
    expect(codex?.rssBytes).toBe(1_250_000 * KB)
  })

  it('does NOT count Chromium’s own processes, which getAppMetrics already reported', () => {
    // The double count this guard exists for: renderer/GPU/utility are OS children of main, so
    // adding every descendant to the getAppMetrics total would report roughly twice the truth.
    const spawned = spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS)
    expect(spawned.map((p) => p.pid)).not.toContain(501)
    expect(spawned.map((p) => p.pid)).not.toContain(502)
    expect(spawned.map((p) => p.pid)).not.toContain(503)
  })

  it('walks THROUGH a counted process to whatever it spawned', () => {
    // pid 700 hangs off the Chromium utility (503). Skipping a counted process's subtree would
    // reopen the same blindness one level down.
    const spawned = spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS)
    expect(spawned.map((p) => p.pid)).toContain(700)
  })

  it('follows a grandchild — an agent that spawned its own tool', () => {
    const spawned = spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS)
    expect(spawned.find((p) => p.name === 'rg')?.rssBytes).toBe(640_000 * KB)
  })

  it('ignores processes that are not ours', () => {
    const spawned = spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS)
    expect(spawned.map((p) => p.name)).not.toContain('SomethingElse')
    expect(spawned.map((p) => p.name)).not.toContain('launchd')
  })

  it('sums to the agents only, never to the whole tree', () => {
    const spawned = spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS)
    expect(totalBytes(spawned)).toBe((1_250_000 + 640_000 + 90_000) * KB)
  })

  it('terminates on a cycle instead of hanging the main process', () => {
    // A ps snapshot is not atomic and pid reuse during one can describe a loop. This runs on the
    // main thread every 30s; a diagnostic that can hang the app it diagnoses is the wrong trade.
    const cyclic: ProcessRow[] = [
      { pid: 500, ppid: 1, rssBytes: 1000, name: 'BroBot2' },
      { pid: 800, ppid: 500, rssBytes: 2000, name: 'a' },
      { pid: 801, ppid: 800, rssBytes: 3000, name: 'b' },
      { pid: 800, ppid: 801, rssBytes: 2000, name: 'a' },
    ]
    const spawned = spawnedDescendants(cyclic, 500, new Set())
    expect(spawned.map((p) => p.pid).sort()).toEqual([800, 801])
  })

  it('does not recurse on a process that parents itself', () => {
    // There is no dedicated guard for this and there does not need to be: `seen` already holds the
    // root before the walk begins, so a self-parenting row is rejected as a repeat. An earlier
    // version had an explicit `row.pid === row.ppid` check; it was removed because no mutation of
    // the code could make this test fail while it was there, which made it untestable rather than
    // safe. This test pins that the `seen` set is what covers the case.
    const selfParent: ProcessRow[] = [
      { pid: 500, ppid: 1, rssBytes: 1000, name: 'BroBot2' },
      { pid: 900, ppid: 500, rssBytes: 2000, name: 'agent' },
      { pid: 900, ppid: 900, rssBytes: 2000, name: 'agent' },
    ]
    expect(spawnedDescendants(selfParent, 500, new Set()).map((p) => p.pid)).toEqual([900])
  })

  it('reports nothing when the app has spawned nothing', () => {
    const bare = parseProcessTable(
      ['  500     1  170000 /Applications/BroBot2.app/Contents/MacOS/BroBot2'].join('\n'),
    )
    expect(spawnedDescendants(bare, OUR_PID, CHROMIUM_PIDS)).toEqual([])
  })
})

describe('describeSpawned', () => {
  const rows = parseProcessTable(PS_OUTPUT)

  it('names the biggest first, because the message exists to name the one that grew', () => {
    const line = describeSpawned(spawnedDescendants(rows, OUR_PID, CHROMIUM_PIDS))
    expect(line.startsWith('codex:')).toBe(true)
    expect(line).toBe('codex:1.19GB rg:0.61GB node:0.09GB')
  })

  it('drops the tail so a hundred small children cannot push the big one off the line', () => {
    // Ordered smallest-first on purpose: a `slice` before the `sort` would keep the four SMALLEST
    // and still produce four entries, so asserting the count alone would not catch it. The names
    // are asserted, at the default limit as well as an explicit one.
    const many = Array.from({ length: 40 }, (_, i) => ({
      pid: 1000 + i,
      rssBytes: (i + 1) * 1024 ** 2,
      name: `tool${i}`,
    }))
    // Four NAMED processes, plus one field for everything it did not name — see the test below.
    expect(describeSpawned(many).split(' ')).toHaveLength(5)
    expect(
      describeSpawned(many).startsWith('tool39:0.04GB tool38:0.04GB tool37:0.04GB tool36:0.04GB'),
    ).toBe(true)
    expect(describeSpawned(many, 2).startsWith('tool39:0.04GB tool38:0.04GB')).toBe(true)
  })

  /**
   * ⛔ **The line accounts for the whole total** (175 §3).
   *
   * `173` measured a run ending at 5.25 GB with a breakdown naming about 1.8 GB of it, and could
   * not tell whether the missing 3.4 GB was a long tail of small children or one process nobody
   * was naming. The tail is a count and a sum now, so the arithmetic closes.
   */
  it('states what the dropped tail is holding, so the sum of the line IS the total', () => {
    // One big process and a tail heavy enough to be the story: 4 × 1 GB named, 20 × 0.5 GB
    // dropped. The old line said 4.00 GB about a tree holding 14.00 GB.
    const heavy = [
      ...Array.from({ length: 4 }, (_, i) => ({
        pid: 100 + i,
        rssBytes: 1024 ** 3,
        name: `big${i}`,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        pid: 200 + i,
        rssBytes: 1024 ** 3 / 2,
        name: `small${i}`,
      })),
    ]
    const line = describeSpawned(heavy)
    expect(line).toContain('+20more:10.00GB')
    // The arithmetic, asserted rather than eyeballed: every GB figure on the line adds up to the
    // total the watchdog states for the agents, which is the whole point of the tail.
    const stated = [...line.matchAll(/:(\d+\.\d\d)GB/g)].reduce((sum, m) => sum + Number(m[1]), 0)
    expect(stated).toBeCloseTo(totalBytes(heavy) / 1024 ** 3, 2)
  })

  it('has no tail field when nothing was dropped, so a short list reads as it always did', () => {
    const few = Array.from({ length: 3 }, (_, i) => ({
      pid: 300 + i,
      rssBytes: 1024 ** 3,
      name: `only${i}`,
    }))
    expect(describeSpawned(few)).toBe('only0:1.00GB only1:1.00GB only2:1.00GB')
    expect(describeSpawned(few)).not.toContain('more')
  })

  it('is empty when there is nothing to add, so it names no agent', () => {
    expect(describeSpawned([])).toBe('')
  })
})

describe('createSpawnedReader', () => {
  /** A reader whose clock and whose `ps` are both under the test's control. */
  function harness(deadlineMs = 10_000) {
    let now = 1_000
    const pending: Array<(error: Error | null, table: string) => void> = []
    let started = 0
    const reader = createSpawnedReader({
      now: () => now,
      rootPid: OUR_PID,
      chromiumPids: () => CHROMIUM_PIDS,
      deadlineMs,
      read: (done) => {
        started += 1
        pending.push(done)
      },
    })
    return {
      reader,
      starts: () => started,
      advance: (ms: number) => {
        now += ms
      },
      succeed: (table = PS_OUTPUT) => pending.shift()?.(null, table),
      fail: () => pending.shift()?.(new Error('ps died'), ''),
    }
  }

  it('reports nothing before the first reading comes back', () => {
    const h = harness()
    h.reader.refresh()
    expect(h.reader.snapshot()).toEqual([])
    expect(h.reader.failed()).toBe(false)
  })

  it('does not queue a second reading behind one still in flight', () => {
    // Inside the deadline on purpose: past it, starting another is the CORRECT behaviour and is
    // what the next test pins. A `ps` under load takes up to 1.3 s, so overlapping calls are real.
    const h = harness(10_000)
    h.reader.refresh()
    h.advance(1_000)
    h.reader.refresh()
    h.advance(1_000)
    h.reader.refresh()
    expect(h.starts()).toBe(1)
  })

  it('starts a new reading once the deadline passes, so a wedged ps cannot silence it forever', () => {
    // THE fix under test. `execFile`'s timeout signals the child, but the callback only runs when
    // the child EXITS — a process wedged in uninterruptible sleep never calls back. Without the
    // deadline the in-flight flag stays set for the lifetime of the app and the watchdog silently
    // reverts to being blind to every agent, which is what this whole module exists to prevent.
    const h = harness(10_000)
    h.reader.refresh() // this one never calls back — ever
    h.advance(9_999)
    h.reader.refresh()
    expect(h.starts()).toBe(1) // still within the deadline
    h.advance(2)
    h.reader.refresh()
    expect(h.starts()).toBe(2) // and now it has given up waiting
  })

  it('publishes the reading when it succeeds', () => {
    const h = harness()
    h.reader.refresh()
    h.succeed()
    expect(h.reader.snapshot().map((p) => p.name)).toEqual(['codex', 'node', 'rg'])
    expect(h.reader.failed()).toBe(false)
  })

  it('says it FAILED rather than saying there was nothing', () => {
    // An unreadable `ps` and a machine with no agents both produce an empty list. Conflating them
    // turns "we could not see" into "there was nothing to see", in a line read after the evidence
    // is gone.
    const h = harness()
    h.reader.refresh()
    h.succeed()
    expect(h.reader.snapshot()).toHaveLength(3)
    h.advance(30_000)
    h.reader.refresh()
    h.fail()
    expect(h.reader.snapshot()).toEqual([])
    expect(h.reader.failed()).toBe(true)
  })

  it('clears the failure once a reading works again', () => {
    const h = harness()
    h.reader.refresh()
    h.fail()
    expect(h.reader.failed()).toBe(true)
    h.advance(30_000)
    h.reader.refresh()
    h.succeed()
    expect(h.reader.failed()).toBe(false)
    expect(h.reader.snapshot()).toHaveLength(3)
  })

  it('holds the previous reading steady between refreshes', () => {
    const h = harness()
    h.reader.refresh()
    h.succeed()
    const first = h.reader.snapshot()
    h.advance(30_000)
    h.reader.refresh() // in flight, not yet answered
    expect(h.reader.snapshot()).toEqual(first)
  })
})
