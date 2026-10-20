import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, describe as platformDescribe, expect, it } from 'vitest'
import {
  bounded,
  cancellation,
  stopApp as correctedStopApp,
  withIndependentDrain as correctedDrain,
} from '../gates/plugin-packaged/processes.mjs'
import { removeFixture as correctedRemove } from '../gates/plugin-packaged/prepare.mjs'
import { ownedRoot } from '../gates/plugin-packaged/contract.mjs'
// Kernel process observations are POSIX-only; Windows has no such gate.
const describe = platformDescribe.skipIf(process.platform === 'win32')
const roots = []
let stopApp = correctedStopApp,
  withIndependentDrain = correctedDrain,
  removeFixture = correctedRemove
// Read-only replay of the frozen implementation for the three regression receipts.
if (process.env.PLUGIN_GATE_CLEANUP_OLD === 'd97933dcc') {
  const read = (name) =>
    execFileSync('/usr/bin/git', ['show', 'd97933dcc:' + name], { encoding: 'utf8' })
  const journey = read('scripts/gates/plugin-packaged/journey.mjs')
  const oldStop = journey.slice(
    journey.indexOf('async function stopApp('),
    journey.indexOf('async function plugins('),
  )
  stopApp = Function(
    'bounded',
    'return (' + oldStop + ')',
  )((work, ms) => bounded(work, Math.min(ms, 30)))
  const prepare = read('scripts/gates/plugin-packaged/prepare.mjs')
  const oldRemove = prepare
    .slice(
      prepare.indexOf('export function removeFixture('),
      prepare.indexOf('async function main('),
    )
    .replace('export ', '')
  removeFixture = Function(
    'fs',
    'path',
    'ownedRoot',
    'return (' + oldRemove + ')',
  )(fs, path, ownedRoot)
  const oldCommand = prepare
    .slice(
      prepare.indexOf('export async function command('),
      prepare.indexOf('export async function prepare('),
    )
    .replace('export ', '')
  withIndependentDrain = async (work) =>
    Function(
      'exec',
      'fixtureEnvironment',
      'repository',
      'return (' + oldCommand + ')',
    )(work, () => ({}), '/fictional')('/fictional', [], '/fictional')
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
// All process identities are fictional; no provider program or browser is started here.
describe('packaged gate interruption cleanup', () => {
  it('waits for actual exit after SIGKILL and keeps an unproved exit failed', async () => {
    let exited,
      settled = false,
      failed = false
    const signals = []
    const run = {
      child: { kill: (signal) => signals.push(signal) },
      exit: new Promise((resolve) => {
        exited = resolve
      }),
      stopped: false,
    }
    const result = stopApp(run, 30)
      .catch(() => {
        failed = true
      })
      .finally(() => {
        settled = true
      })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(settled).toBe(false)
    expect(run.stopped).toBe(false)
    exited()
    await result
    expect(run.stopped).toBe(true)
    expect(failed).toBe(false)
    const noExit = { child: { kill() {} }, exit: new Promise(() => {}), stopped: false }
    await expect(stopApp(noExit, 5)).rejects.toThrow()
    expect(noExit.stopped).toBe(false)
  })
  it.each(['timeout', 'cancel', 'killed-journey'])(
    'an independent owner drains reparented children after %s',
    async (kind) => {
      // A detached service and its child remain after the journey leader disappears.
      const live = new Map([
        [41001, 'birth-a'],
        [41002, 'birth-b'],
      ])
      let witness
      const adapter = {
        list: async () => [...live].map(([pid, birth]) => ({ pid, birth })),
        signal: async (row) => {
          if (live.get(row.pid) === row.birth) live.delete(row.pid)
        },
      }
      await expect(
        withIndependentDrain(
          async () => {
            throw new Error(kind)
          },
          adapter,
          async (value) => {
            witness = value
          },
          { grace: 0, deadline: 100 },
        ),
      ).rejects.toThrow()
      expect([...live]).toEqual([])
      expect(witness).toEqual({ exited: true, processes: 2 })
    },
  )
  it('retains roots when a child has no exit witness, and refuses a stale empty receipt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-drain-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
    fs.writeFileSync(path.join(root, 'kept'), 'fictional')
    const remove = (receipt, current) => removeFixture(fs.realpathSync(root), receipt, current)
    for (const [receipt, current] of [
      [undefined, []],
      [{ exited: false, processes: 1 }, []],
      [{ exited: true, processes: 0 }, [{ pid: 41001, birth: 'new' }]],
    ]) {
      expect(() => remove(receipt, current)).toThrow('Child exit witnesses missing')
      expect(fs.existsSync(path.join(root, 'kept'))).toBe(true)
    }
    remove({ exited: true, processes: 1 }, [])
    expect(fs.existsSync(root)).toBe(false)
  })
  it.each(['SIGTERM', 'SIGINT'])(
    'the independent owner drains after an actual %s cancellation event',
    async (signal) => {
      const source = new EventEmitter(),
        abort = cancellation(source)
      let live = true,
        witnessed = false
      const adapter = {
        list: async () => (live ? [{ pid: 41001, birth: 'detached' }] : []),
        signal: async () => {
          live = false
        },
      }
      const work = withIndependentDrain(
        () =>
          new Promise((_, reject) =>
            abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
              once: true,
            }),
          ),
        adapter,
        async () => {
          witnessed = true
        },
        { grace: 0, deadline: 100 },
      )
      source.emit(signal)
      await expect(work).rejects.toThrow('cancelled')
      expect(live).toBe(false)
      expect(witnessed).toBe(true)
      abort.close()
      expect(source.listenerCount(signal)).toBe(0)
    },
  )
  it('fences every launcher before taking an empty exit census', async () => {
    let fenced = false,
      witness = false
    const adapter = {
      stopLaunchers: async () => {
        fenced = true
      },
      list: async () => {
        expect(fenced).toBe(true)
        return []
      },
      signal: async () => {
        throw new Error('No process expected')
      },
    }
    await withIndependentDrain(
      async () => {},
      adapter,
      async () => {
        witness = true
      },
      { deadline: 100 },
    )
    expect(witness).toBe(true)
  })
  it('does not call removal when even one owned process cannot be stopped', async () => {
    let removed = false
    const adapter = { list: async () => [{ pid: 41001, birth: 'stuck' }], signal: async () => {} }
    await expect(
      withIndependentDrain(
        async () => {},
        adapter,
        async () => {
          removed = true
        },
        { grace: 0, deadline: 20 },
      ),
    ).rejects.toThrow('roots retained')
    expect(removed).toBe(false)
  })
  it('also bounds a missing exit instead of accepting the signal itself as success', async () => {
    const child = new EventEmitter()
    await expect(bounded(new Promise((resolve) => child.once('exit', resolve)), 5)).rejects.toThrow(
      'deadline',
    )
  })
})

import { runnerAdapter } from '../gates/plugin-packaged/runner-processes.mjs'
describe('killed journey witness', () => {
  it('drains a real detached scratch child after killing only the journey leader', async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-killed-journey-')),
    )
    roots.push(root)
    fs.chmodSync(root, 0o700)
    fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
    const sleeper = path.join(root, 'fern-sleeper')
    fs.copyFileSync('/bin/sleep', sleeper)
    fs.chmodSync(sleeper, 0o700)
    const script = path.join(root, 'journey.cjs')
    fs.writeFileSync(
      script,
      `const {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(sleeper)},['60'],{detached:true,stdio:'ignore'});child.unref();process.send(child.pid);setInterval(()=>{},1000);`,
    )
    const leader = spawn(process.execPath, [script], {
      env: { HOME: root, PATH: '/usr/bin:/bin' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const exit = new Promise((resolve) => leader.once('exit', resolve))
    let orphan
    try {
      orphan = await bounded(
        new Promise((resolve, reject) => {
          leader.once('message', resolve)
          leader.once('error', reject)
        }),
        2000,
      )
      leader.kill('SIGKILL')
      await bounded(exit, 2000)
      expect(() => process.kill(orphan, 0)).not.toThrow()
      const adapter = runnerAdapter(root, 'roots', {
        read: async () => {
          try {
            return execFileSync('/bin/ps', ['-p', String(orphan), '-o', 'pid=,pgid=,lstart='], {
              encoding: 'utf8',
            })
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((row) => {
                const [, pid, group, birth] = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(row)
                return { pid: Number(pid), group: Number(group), birth, executable: sleeper }
              })
          } catch (error) {
            if (error.status === 1) return []
            throw error
          }
        },
        send: (group, signal) => process.kill(-group, signal),
      })
      let receipt
      await expect(
        withIndependentDrain(
          async () => {
            throw new Error('journey killed')
          },
          adapter,
          async (value) => {
            receipt = value
          },
          { grace: 0, deadline: 2000 },
        ),
      ).rejects.toThrow()
      expect(await adapter.list()).toEqual([])
      expect(receipt?.exited).toBe(true)
    } finally {
      leader.kill('SIGKILL')
      await bounded(exit, 2000)
      if (orphan)
        try {
          process.kill(orphan, 'SIGKILL')
        } catch (error) {
          expect(error.code).toBe('ESRCH')
        }
      if (orphan)
        await bounded(
          (async () => {
            for (;;) {
              try {
                process.kill(orphan, 0)
              } catch (error) {
                if (error.code === 'ESRCH') return
                throw error
              }
              await new Promise((resolve) => setTimeout(resolve, 10))
            }
          })(),
          2000,
        )
    }
  })
})
