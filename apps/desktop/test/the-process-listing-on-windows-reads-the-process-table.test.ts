import { describe, expect, it, vi } from 'vitest'
import {
  WINDOWS_LISTING,
  listProcesses,
  memoryOf,
  parseWindowsListing,
} from '../src/main/runtime/process-listing'

/**
 * # The process listing, on every system
 *
 * What the agents' processes use is read from one listing of the process table: `ps` where there
 * is one, and on Windows, which has none, CIM's `Win32_Process` through PowerShell. Both give the
 * same four facts a line, so the Providers screen and the agents' cards draw the same figures on
 * both systems.
 */

const started = vi.hoisted(() => ({ commands: [] as string[] }))

vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>()
  return {
    ...real,
    execFile: (...args: unknown[]) => {
      started.commands.push(String(args[0]))
      return (real.execFile as (...all: unknown[]) => unknown)(...args)
    },
  }
})

/** 100-nanosecond units, as Windows counts time. */
const SECOND = 10_000_000
const NOW = 133_800_000_000_000_000

/** A fictional table, as WINDOWS_LISTING prints it: pid, parent, working set, CPU time, born, now. */
const TABLE = [
  `0 0 8192 0 0 ${String(NOW)}`,
  `4101 900 209715200 ${String(5 * SECOND)} ${String(NOW - 100 * SECOND)} ${String(NOW)}`,
  `4102 4101 10485760 ${String(SECOND)} ${String(NOW - 10 * SECOND)} ${String(NOW)}`,
  'not a line of the table',
  `4103 4101 1024 ${String(SECOND)}`,
  '',
].join('\r\n')

describe('the listing on Windows', () => {
  it('🔴 is read from the process table through PowerShell, and starts no `ps`', async () => {
    started.commands.length = 0
    const asked: string[] = []
    const rows = await listProcesses('win32', async (command) => {
      asked.push(command)
      return TABLE
    })
    expect(asked).toEqual([WINDOWS_LISTING])
    expect(WINDOWS_LISTING).toContain('Get-CimInstance Win32_Process')
    expect(started.commands).toEqual([])
    expect(rows).toEqual([
      { pid: 0, ppid: 0, rssKb: 8, cpu: 0 },
      // 200 MiB of working set; 5 s of CPU over a 100 s life is 5 %.
      { pid: 4101, ppid: 900, rssKb: 204_800, cpu: 5 },
      { pid: 4102, ppid: 4101, rssKb: 10_240, cpu: 10 },
    ])
  })

  it('skips what is not a line of the table, and a table with no line it can read is a failure', async () => {
    expect(parseWindowsListing('pid ppid\r\n1 2 3\r\n')).toEqual([])
    await expect(listProcesses('win32', async () => 'nothing here\r\n')).rejects.toThrow(
      'the process listing had no line it could read',
    )
    await expect(
      listProcesses('win32', async () => {
        throw new Error('fictional: PowerShell could not start')
      }),
    ).rejects.toThrow('PowerShell could not start')
  })

  it("answers each asked pid's memory in bytes, and leaves out one the table does not hold", () => {
    const rows = parseWindowsListing(TABLE)
    expect(memoryOf([4101, 4102, 9999], rows)).toEqual(
      new Map([
        [4101, 209_715_200],
        [4102, 10_485_760],
      ]),
    )
  })

  it('on this computer, if it is Windows, lists this very process with its parent and its memory', async (ctx) => {
    ctx.skip(process.platform !== 'win32', 'the CIM table is Windows’ own')
    const rows = await listProcesses()
    const self = rows.find((row) => row.pid === process.pid)
    expect(self).toMatchObject({ pid: process.pid, ppid: process.ppid })
    expect(self?.rssKb).toBeGreaterThan(1024)
    expect(memoryOf([process.pid], rows).get(process.pid)).toBeGreaterThan(1024 * 1024)
  })
})

describe('the listing elsewhere', () => {
  it('⚑ the control: on a Mac it starts one `ps`, whatever that then answers', async () => {
    started.commands.length = 0
    await listProcesses('darwin').catch(() => undefined)
    expect(started.commands).toEqual(['ps'])
  })
})
