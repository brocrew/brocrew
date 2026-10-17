import { describe, expect, it } from 'vitest'
import {
  createWindowsLifecycle,
  descendantsIn,
  listenersIn,
  parseProcessTable,
} from '../lib/windows-owned-launch.mjs'

/** The Windows half of a launch's ownership, on tables and netstat output written here. */

const row = (pid, parentPid, created, command = `p${String(pid)}.exe`) => ({
  pid,
  parentPid,
  created: String(created),
  executable: command,
  command,
})

describe('the process table', () => {
  it('reads CIM rows, one or many, and drops a row with no pid', () => {
    const one = JSON.stringify({
      ProcessId: 10,
      ParentProcessId: 4,
      Created: 133000,
      ExecutablePath: 'C:\\e\\electron.exe',
      CommandLine: '"C:\\e\\electron.exe" .',
    })
    expect(parseProcessTable(one)).toEqual([
      {
        pid: 10,
        parentPid: 4,
        created: '133000',
        executable: 'C:\\e\\electron.exe',
        command: '"C:\\e\\electron.exe" .',
      },
    ])
    const many = JSON.stringify([
      { ProcessId: 0, ParentProcessId: 0, Created: null, ExecutablePath: null, CommandLine: null },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        Created: 133001,
        ExecutablePath: null,
        CommandLine: null,
      },
    ])
    expect(parseProcessTable(many)).toEqual([
      { pid: 11, parentPid: 10, created: '133001', executable: '', command: '' },
    ])
  })

  it('walks a tree parents first, and not into a process older than the parent it names', () => {
    const table = [row(10, 4, 100), row(11, 10, 101), row(12, 11, 102), row(13, 10, 50)]
    expect(descendantsIn(table, table[0]).map((one) => one.pid)).toEqual([11, 12])
  })
})

describe('netstat', () => {
  it('names who listens on the port, and nobody listening on another', () => {
    const out = [
      'Active Connections',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    127.0.0.1:53211        0.0.0.0:0              LISTENING       4242',
      '  TCP    127.0.0.1:53211        127.0.0.1:60000        ESTABLISHED     4242',
      '  TCP    [::1]:53211            [::]:0                 LISTENING       4243',
      '  TCP    0.0.0.0:5321           0.0.0.0:0              LISTENING       99',
    ].join('\r\n')
    expect(listenersIn(out, 53211)).toEqual([4242, 4243])
    expect(listenersIn(out, 1)).toEqual([])
  })
})

describe('a launch on Windows', () => {
  /** A table that loses each process once it has been killed `after` times. */
  function aMachine(rows, { after = 1, stubborn = [] } = {}) {
    let table = [...rows]
    const killed = []
    return {
      killed,
      readTable: () => table,
      kill: (pid) => {
        killed.push(pid)
        if (stubborn.includes(pid)) return
        if (killed.filter((one) => one === pid).length >= after) {
          table = table.filter((one) => one.pid !== pid)
        }
      },
      add: (one) => table.push(one),
    }
  }

  it('is refused until its process is in the table', () => {
    const machine = aMachine([row(4, 1, 1)])
    expect(() => createWindowsLifecycle({ launcherPid: 10, readTable: machine.readTable })).toThrow(
      /not in the table/,
    )
  })

  it('ends its tree by pid and is complete once none of it is left', () => {
    const machine = aMachine([row(4, 1, 1), row(10, 4, 100), row(11, 10, 101)])
    const lifecycle = createWindowsLifecycle({
      launcherPid: 10,
      readTable: machine.readTable,
      kill: machine.kill,
      pause: () => undefined,
    })
    machine.add(row(12, 11, 102))
    expect(lifecycle.refreshDescendants()).toBe(true)
    expect(lifecycle.processes().map((one) => one.pid)).toEqual([10, 11, 12])
    expect(lifecycle.kill9()).toMatchObject({ complete: true, alive: [] })
    expect(machine.killed).toEqual([10, 11, 12])
    expect(machine.readTable().map((one) => one.pid)).toEqual([4])
  })

  it('never ends a process that only reuses one of its pids', () => {
    const machine = aMachine([row(10, 4, 100), row(11, 10, 101)])
    const lifecycle = createWindowsLifecycle({
      launcherPid: 10,
      readTable: machine.readTable,
      kill: machine.kill,
      pause: () => undefined,
    })
    lifecycle.refreshDescendants()
    // 11 ended and its pid went to a stranger started later.
    const table = machine.readTable()
    table.splice(1, 1, row(11, 7, 900))
    expect(lifecycle.kill9().complete).toBe(true)
    expect(machine.killed).toEqual([10])
  })

  it('is not complete while a process of it stays, and says which', () => {
    const machine = aMachine([row(10, 4, 100), row(11, 10, 101)], { stubborn: [11] })
    const lifecycle = createWindowsLifecycle({
      launcherPid: 10,
      readTable: machine.readTable,
      kill: machine.kill,
      pause: () => undefined,
      attempts: 3,
    })
    lifecycle.refreshDescendants()
    expect(lifecycle.kill9()).toMatchObject({ complete: false, alive: [11] })
  })

  it('is not complete when the table cannot be read', () => {
    const machine = aMachine([row(10, 4, 100)])
    let readable = true
    const lifecycle = createWindowsLifecycle({
      launcherPid: 10,
      readTable: () => {
        if (!readable) throw new Error('powershell is gone')
        return machine.readTable()
      },
      kill: machine.kill,
      pause: () => undefined,
    })
    readable = false
    expect(lifecycle.kill9().complete).toBe(false)
  })
})
