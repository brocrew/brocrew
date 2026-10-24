import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import {
  endTree,
  isRunning,
  readTable,
  startEnder,
  type Ending,
  type TreeEnding,
} from '../src/codex/windows-tree'

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }))

function helper() {
  return Object.assign(new EventEmitter(), {
    stdin: Object.assign(new PassThrough(), { end: vi.fn() }),
    stdout: new PassThrough(),
    kill: vi.fn(),
  })
}
let child: ReturnType<typeof helper>
beforeEach(() => {
  vi.useFakeTimers()
  child = helper()
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
})
afterEach(() => {
  child.removeAllListeners()
  child.stdin.removeAllListeners()
  child.stdout.removeAllListeners()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('the Windows process table adapter', () => {
  it('does not start a command without a positive time budget', async () => {
    expect(await readTable(0)).toBeNull()
    expect(await readTable(-1)).toBeNull()
    expect(execFile).not.toHaveBeenCalled()
  })
  it.each([
    [
      'at 800\n41 2 700\n42 41 750\n',
      null,
      {
        at: 800n,
        rows: [
          { pid: 41, ppid: 2, created: 700n },
          { pid: 42, ppid: 41, created: 750n },
        ],
      },
    ],
    ['41 2 700\n', null, null],
    ['at invalid\n41 2 700\n', null, null],
    ['at 800\n', null, null],
    ['at 800\n41 2 700\n', new Error('fictional timeout'), null],
  ] as const)('parses only a successful timestamped table: %s', async (stdout, error, expected) => {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, text: string) => void
      callback(error, stdout)
      return {} as ReturnType<typeof execFile>
    })
    expect(await readTable(127)).toEqual(expected)
    expect(execFile).toHaveBeenCalledExactlyOnceWith(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '"at $([DateTime]::UtcNow.ToFileTimeUtc())"; Get-CimInstance Win32_Process | ForEach-Object { $born = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }; "$($_.ProcessId) $($_.ParentProcessId) $born" }',
      ],
      { timeout: 127, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      expect.any(Function),
    )
  })
})

describe('the Windows process ending adapter', () => {
  const rows = [
    { pid: 42, ppid: 41, created: 750n },
    { pid: 43, ppid: 41, created: 760n },
  ]
  it('sends identities and a bounded integer budget, reassembles output and retains unanswered failures', async () => {
    const ender = startEnder()
    const command =
      '$line = [Console]::In.ReadLine(); if (-not $line) { exit 0 }; ' +
      "$parts = $line.Split('|'); $until = [DateTime]::UtcNow.AddMilliseconds([int]$parts[1]); " +
      '$ending = @(); ' +
      "foreach ($t in $parts[0].Split(' ', [StringSplitOptions]::RemoveEmptyEntries)) { " +
      "$id, $born = $t.Split(':'); " +
      'try { $p = [System.Diagnostics.Process]::GetProcessById([int]$id) } catch { "gone $t"; continue }; ' +
      'try { $null = $p.Handle; ' +
      'if ([Math]::Abs($p.StartTime.ToFileTimeUtc() - [long]$born) -ge 10) { "another $t"; continue }; ' +
      '$p.Kill(); $ending += ,@($t, $p) } ' +
      'catch { if ($p.HasExited) { "gone $t" } else { "failed $t" } } }; ' +
      'foreach ($e in $ending) { ' +
      '$left = [Math]::Max(0, [int]($until - [DateTime]::UtcNow).TotalMilliseconds); ' +
      'if ($e[1].WaitForExit($left)) { "ended $($e[0])" } else { "alive $($e[0])" } }'
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    )
    const ending = ender.end(rows, 78.9)
    expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith('42:750 43:760|78\n')
    child.stdout.emit('data', 'end')
    child.stdout.emit('data', 'ed 42:750\r\n')
    child.emit('exit')
    expect([...(await ending)]).toEqual([
      ['42:750', 'ended'],
      ['43:760', 'failed'],
    ])
    expect(child.kill).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cannot invent an exit result when spawning the helper throws', async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('fictional spawn failure')
    })
    expect([...(await startEnder().end(rows, 50))]).toEqual([
      ['42:750', 'failed'],
      ['43:760', 'failed'],
    ])
    expect(child.kill).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('contains a spawn error and settles missing answers as failures', async () => {
    const ending = startEnder().end(rows, 50)
    expect(() => child.emit('error', new Error('fictional launch error'))).not.toThrow()
    expect([...(await ending)]).toEqual([
      ['42:750', 'failed'],
      ['43:760', 'failed'],
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('contains EPIPE while a silent helper reaches its deadline', async () => {
    const ending = startEnder().end(rows, 50)
    let settled = false
    void ending.then(() => {
      settled = true
    })
    expect(() =>
      child.stdin.emit('error', Object.assign(new Error('fictional pipe'), { code: 'EPIPE' })),
    ).not.toThrow()
    await vi.advanceTimersByTimeAsync(49)
    expect(settled).toBe(false)
    expect(child.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect([...(await ending)].every(([, result]) => result === 'failed')).toBe(true)
    expect(child.kill).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('dismisses an unused helper without sending targets or arming a deadline', async () => {
    const ender = startEnder()
    expect([...(await ender.end([], 50))]).toEqual([])
    expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith()
    expect(child.kill).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    child.stdin.end.mockClear()
    ender.dismiss()
    expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith()
  })
})

it.each([
  [undefined, true],
  ['ESRCH', false],
  ['EPERM', true],
  ['EINVAL', false],
] as const)('probes existence without ending a process: %s', (code, expected) => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    if (code) throw Object.assign(new Error('fictional probe'), { code })
    return true
  })
  expect(isRunning(42)).toBe(expected)
  expect(kill).toHaveBeenCalledExactlyOnceWith(42, 0)
})

it.each(['failed', 'alive', 'ended', 'gone', 'another'] as const)(
  'reports descendant cleanup outcome %s without promoting uncertainty to proof',
  async (outcome) => {
    const warn = vi.fn()
    const end = vi.fn(async () => new Map<string, Ending>([['42:750', outcome]]))
    const ending: TreeEnding = {
      leader: { pid: 41, startedAt: 700n },
      leaderEndedAt: () => 900n,
      awaitLeader: async () => true,
      endLeader: vi.fn(),
      known: () => [],
      remember: vi.fn(),
      read: async () => ({ at: 950n, rows: [{ pid: 42, ppid: 41, created: 750n }] }),
      startEnder: () => ({ end, dismiss: vi.fn() }),
      isRunning: () => true,
      now: () => Date.now(),
      sleep: async () => {},
      graceMs: 0,
      killGraceMs: 0,
      budgetMs: 2000,
      warn,
    }
    expect(await endTree(ending)).toBe(outcome !== 'failed' && outcome !== 'alive')
    expect(end).toHaveBeenCalledExactlyOnceWith([{ pid: 42, ppid: 41, created: 750n }], 2000)
    if (outcome === 'failed' || outcome === 'alive') {
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `codex app-server 41: may still be running after 2000ms: 42:750 ${outcome}`,
      )
    } else expect(warn).not.toHaveBeenCalled()
  },
)
