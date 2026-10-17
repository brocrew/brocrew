import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  captureProcessIdentity,
  createOwnedProcessLifecycle,
  defaultReadProcessIdentity,
} from '../lib/owned-process.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const identity = ({
  pid,
  start = `start-${pid}`,
  executable = `/repo/bin/process-${pid}`,
  parentPid = 900,
  pgid = pid,
  command = `process-${pid} --owned`,
  // ⚠️ `S` — sleeping, which is what a live process reads as. It is carried on the identity and
  // deliberately excluded from the saved authority; see the two tests directly below.
  runState = 'S',
}) => ({ pid, start, executable, parentPid, pgid, command, runState })

function fakeProcesses(...initial) {
  const processes = new Map(initial.map((item) => [item.pid, { ...item }]))
  const reads = []
  const unreadable = new Set()
  return {
    processes,
    reads,
    unreadable,
    readIdentity(pid) {
      reads.push(pid)
      if (unreadable.has(pid)) throw new Error(`identity ${pid} is unreadable`)
      const current = processes.get(pid)
      return current ? { ...current } : null
    },
  }
}

describe('owned process identity', () => {
  it('captures every immutable identity field twice and refuses an identity that changes mid-capture', () => {
    const source = identity({
      pid: 101,
      start: 'Tue Sep 1 12:00:00 2026',
      executable: '/repo/Electron',
      parentPid: 100,
      pgid: 100,
      command: '/repo/Electron --remote-debugging-port=49152',
    })
    const captured = captureProcessIdentity(101, { readIdentity: () => source })

    expect(captured).toEqual(source)
    expect(Object.isFrozen(captured)).toBe(true)
    source.start = 'reused pid'
    source.command = 'foreign command'
    expect(captured.start).toBe('Tue Sep 1 12:00:00 2026')
    expect(captured.command).toBe('/repo/Electron --remote-debugging-port=49152')

    let sample = 0
    expect(
      captureProcessIdentity(101, {
        readIdentity: () => identity({ pid: 101, start: `sample-${sample++}` }),
      }),
    ).toBeNull()
  })

  it('does not let a change of run state look like a change of process', () => {
    // ⛔ 333. `runState` is read on every sample and compared against nothing: a process moves
    // between `S`, `R` and `SN` while it runs, and a capture that refused on that would refuse
    // every busy process — which is a teardown with no authority to kill anything.
    let sample = 0
    const captured = captureProcessIdentity(102, {
      readIdentity: () => identity({ pid: 102, runState: sample++ === 0 ? 'S' : 'R' }),
    })
    expect(captured).not.toBeNull()
    expect(captured.runState).toBe('R')
  })
})

/**
 * ⛔ **The real `ps` parse, against a real process, with `ps` itself as the oracle.**
 *
 * ⚠️ Every other test in this file injects `readIdentity`, which is right — they are about the
 * ruling, not the reader. But that leaves the reader itself asserted by nothing, and it is a
 * positional parse of a multi-field `ps` line where one of the fields (`lstart`) is the only one
 * with spaces in it. 🔴 333 added `state` to that line; putting it after `lstart` instead of before
 * it, or reading the wrong capture group, silently makes `start` the state letter and `runState`
 * empty — at which point no zombie is ever recognised and every teardown runs to its bound.
 *
 * ⚑ **The oracle is a different question to the same instrument**: one `ps` per field, so the
 * product's positional parse is checked against a read that has no positions to get wrong.
 */
// This oracle reads POSIX ps fields; Windows process enumeration has a different interface.
describe.skipIf(process.platform === 'win32')('reading one process out of ps', () => {
  const askPs = (field) =>
    execFileSync('ps', ['-ww', '-p', String(process.pid), '-o', `${field}=`], {
      encoding: 'utf8',
    }).trim()

  it('lands every field where ps says it is, including the one with spaces in it', () => {
    const read = defaultReadProcessIdentity(process.pid)

    expect(read).not.toBeNull()
    expect(read.pid).toBe(process.pid)
    expect(read.start).toBe(askPs('lstart'))
    expect(read.parentPid).toBe(Number(askPs('ppid')))
    expect(read.pgid).toBe(Number(askPs('pgid')))
    expect(read.executable).toBe(askPs('comm'))
    // ⛔ **Non-empty and not the start time**: an empty `runState` is exactly what a mis-ordered
    // field list produces, and it reads as *"this is not a zombie"* about every process there is.
    //
    // ⚠️ **387 · this is the one field on the line that MOVES, so the oracle is its SHAPE and not a
    // second reading of it.** It used to be `toBe(askPs('state'))` — two samples of a value that
    // changes with what the machine is doing between them. Measured on this machine, 120 pairs
    // each: idle, both reads say `S` every time; under twelve busy workers, both say `R` every
    // time. ⛔ Neither regime disagrees with itself, and the equality only fails when the LOAD
    // changes across the pair — which is precisely what a thirty-file parallel run does, and is how
    // this landed as an intermittent red in `pnpm run ci` that names a process state and means a
    // scheduler.
    //
    // ⚑ **The claim being protected is positional, and the shape carries all of it**: a state
    // letter with optional flags is not the date `lstart` produces, not the digits `pgid` produces,
    // and not the lowercase `comm` — so a field list read one column across still fails here.
    const A_PS_STATE = /^[A-Z][A-Za-z+<>]*$/
    expect(read.runState).toMatch(A_PS_STATE)
    // ⚑ …and the control that keeps that regex honest: `ps` itself has to satisfy it, or the shape
    // above describes nothing and the assertion is a comment.
    expect(askPs('state')).toMatch(A_PS_STATE)
    expect(read.runState).not.toBe('')
    // ⛔ …and it is none of its NEIGHBOURS on the same line, which is the mis-order this test is
    // named after said as a fact rather than as a shape.
    expect([read.start, String(read.pgid), String(read.parentPid), read.executable]).not.toContain(
      read.runState,
    )
    expect(read.start).toMatch(/\d{4}$/)
  })

  it('says gone, rather than throwing, when ps has no row for a pid', () => {
    // ⚠️ **Five candidates, and `ps` itself decides which of them count.** A pid freshly vacated by
    // a collected child is the only kind this can honestly ask about, and the OS may hand that
    // number straight to something else — this suite spawns a `ps` per field, so that is not
    // hypothetical. Asking `ps` first is what keeps this an assertion about the MAPPING (exit
    // status 1 → `null`) rather than a bet on pid allocation.
    const absent = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pid = Number(execFileSync('/bin/sh', ['-c', 'echo $$'], { encoding: 'utf8' }).trim())
      let stillThere = true
      try {
        execFileSync('ps', ['-p', String(pid)], { stdio: ['ignore', 'ignore', 'ignore'] })
      } catch {
        stillThere = false
      }
      if (!stillThere) absent.push(pid)
    }

    expect(absent.length).toBeGreaterThan(0)
    for (const pid of absent) expect(defaultReadProcessIdentity(pid)).toBeNull()
  })
})

describe('ownership-scoped teardown', () => {
  it('signals a saved child after it reparents to init, then disarms and stays idempotent', () => {
    const launcher = identity({ pid: 200, parentPid: 50, pgid: 200, command: 'pnpm launch' })
    const listener = identity({
      pid: 201,
      parentPid: 200,
      pgid: 200,
      executable: '/repo/Electron',
      command: '/repo/Electron --remote-debugging-port=49152',
    })
    const fake = fakeProcesses(launcher, listener)
    const events = new EventEmitter()
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: events,
      timers: { pause: () => {} },
      killer(pid, signal) {
        signals.push([pid, signal])
        if (pid === -launcher.pid) {
          fake.processes.delete(launcher.pid)
          // This is the path the old process-group-only reaper lost.
          fake.processes.set(listener.pid, { ...listener, parentPid: 1 })
        }
        if (pid === listener.pid) fake.processes.delete(listener.pid)
      },
    })
    lifecycle.remember(listener.pid)

    expect(events.listenerCount('exit')).toBe(1)
    const first = lifecycle.stop()
    expect(first).toMatchObject({ complete: true, signals: 2, remaining: [], unverifiable: [] })
    expect(signals).toEqual([
      [-launcher.pid, 'SIGTERM'],
      [listener.pid, 'SIGTERM'],
    ])
    expect(events.listenerCount('exit')).toBe(0)
    expect(lifecycle.armed).toBe(false)

    expect(lifecycle.stop()).toBe(first)
    expect(lifecycle.kill9()).toBe(first)
    expect(signals).toHaveLength(2)
  })

  it('never signals a reused pid, and does not wait for one either', () => {
    const launcher = identity({ pid: 300, parentPid: 50, pgid: 300, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      killer: (pid, signal) => signals.push([pid, signal]),
      timers: { pause: () => {} },
      attempts: 2,
    })

    // The pid still exists and `lstart` says the kernel started it at a different moment, which is
    // the one thing a live process cannot arrange. It is somebody else's.
    fake.processes.set(launcher.pid, { ...launcher, start: 'replacement launcher' })
    const result = lifecycle.stop()

    expect(result).toMatchObject({ complete: true, remaining: [], exiting: [] })
    expect(signals).toEqual([])
  })

  /**
   * 🔴 **333.** This pair used to be one test asserting `complete: true` for both pids at once. The
   * launcher half is right and is above. The child half was the defect: same `lstart`, so it is the
   * same process — still in the table, still holding its files — and calling that complete is what
   * let the caller remove a directory it was still writing into.
   *
   * ⚠️ **The safety property is unchanged and asserted here**: an identity that no longer matches
   * earns no `kill`. What changed is that it no longer earns a green either.
   */
  it('waits for a saved child that is still in the table under a name it no longer answers to', () => {
    const launcher = identity({ pid: 300, parentPid: 50, pgid: 300, command: 'pnpm launch' })
    const child = identity({
      pid: 301,
      parentPid: 300,
      pgid: 300,
      executable: '/repo/Electron',
      command: '/repo/Electron --owned',
    })
    const fake = fakeProcesses(launcher, child)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      killer: (pid, signal) => signals.push([pid, signal]),
      timers: { pause: () => {} },
      attempts: 2,
    })
    lifecycle.remember(child.pid)

    // Exactly what macOS `ps` reports for a process being torn down: the launcher is gone, and the
    // child keeps its pid, its start and its group while `comm` and `command` become `(Electron)`.
    fake.processes.delete(launcher.pid)
    fake.processes.set(child.pid, {
      ...child,
      parentPid: 1,
      executable: '(Electron)',
      command: '(Electron)',
    })
    const waiting = lifecycle.stop()

    expect(waiting).toMatchObject({ complete: false, remaining: [], exiting: [child.pid] })
    // ⛔ It is waited for and never signalled: the whole identity is what earns a `kill`.
    expect(signals).toEqual([])

    // ...and the moment it leaves the table, the same lifecycle completes.
    fake.processes.delete(child.pid)
    expect(lifecycle.stop()).toMatchObject({ complete: true, exiting: [] })
  })

  /**
   * 🔴 **The regression this pair exists to stop, which 333 shipped for ten minutes.**
   *
   * The launcher is the CALLER's own direct child, so nobody but the caller can collect it — and
   * `blockingPause` stops the caller's event loop, so nothing is collected while a teardown runs.
   * Under the first version of the pid+start rule the launcher therefore read as still-there for
   * the whole 40-attempt bound: **`window:check` went from a ~300 ms reap to 13.1–15.8 s and a red
   * on a green product**, measured over thirteen runs. ⚠️ A zombie holds no descriptor and no page;
   * it cannot be the thing the removal is racing.
   */
  it('does not wait for a pid that has already exited and is only waiting to be collected', () => {
    const launcher = identity({ pid: 310, parentPid: 50, pgid: 310, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      // ⚑ **A freeze is not an ending** (360). `kill9` now sends `SIGSTOP` before it kills, and a
      // fake that treated every signal alike would collect the launcher before the kill — which
      // reads as this test passing for a reason it is not about.
      killer: (pid, signal) => {
        if (signal === 'SIGSTOP') return
        fake.processes.set(launcher.pid, {
          ...launcher,
          runState: 'Z',
          executable: '<defunct>',
          command: '<defunct>',
        })
      },
      timers: { pause: () => {} },
      attempts: 40,
    })

    const result = lifecycle.kill9()
    expect(result).toMatchObject({ complete: true, remaining: [], exiting: [] })
    // ⛔ One attempt, not forty: the bound is not what ended this.
    expect(result.signals).toBe(1)
  })

  /**
   * ⛔ **A zombie the identity comparison cannot tell from a live process.**
   *
   * ⚠️ macOS rewrites a zombie's `comm` to `<defunct>`, so on THIS platform the state check could
   * sit anywhere below `sameRememberedProcess` and nothing would move — which is a fact about one
   * `ps`, not a property of the state, and a mutation row proved it by surviving. Linux's `ps`
   * reports `comm` unchanged for a zombie. This is that shape: every identity field intact, `Z` the
   * only thing that says the process is finished. ⛔ Read after the identity comparison it is
   * `alive`, and the teardown signals a row in a table until its bound runs out.
   */
  it('sees a collected pid even when every identity field still matches', () => {
    const launcher = identity({ pid: 350, parentPid: 50, pgid: 350, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      killer: (pid, signal) => {
        signals.push([pid, signal])
        if (signal === 'SIGSTOP') return
        fake.processes.set(launcher.pid, { ...launcher, runState: 'Z' })
      },
      timers: { pause: () => {} },
      attempts: 40,
    })

    const result = lifecycle.kill9()
    expect(result).toMatchObject({ complete: true, remaining: [], exiting: [] })
    // ⚑ 360: the freeze comes first, on the same group, and only then the kill.
    expect(signals).toEqual([
      [-launcher.pid, 'SIGSTOP'],
      [-launcher.pid, 'SIGKILL'],
    ])
  })

  it('tells a collected pid from one that is still coming down, on the state alone', () => {
    const launcher = identity({ pid: 330, parentPid: 50, pgid: 330, command: 'pnpm launch' })
    const dying = identity({ pid: 331, parentPid: 330, pgid: 330, command: '/repo/Electron' })
    const collected = identity({ pid: 332, parentPid: 330, pgid: 330, command: '/repo/Electron' })
    const fake = fakeProcesses(launcher, dying, collected)
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      killer: () => {},
      timers: { pause: () => {} },
      attempts: 1,
    })
    lifecycle.remember(dying.pid)
    lifecycle.remember(collected.pid)

    fake.processes.delete(launcher.pid)
    // ⚠️ Identical to `ps` in every field the identity holds. The ONLY difference is the state, and
    // the whole ruling turns on it.
    fake.processes.set(dying.pid, {
      ...dying,
      runState: '?E',
      executable: '(Electron)',
      command: '(Electron)',
    })
    fake.processes.set(collected.pid, {
      ...collected,
      runState: 'Z',
      executable: '(Electron)',
      command: '(Electron)',
    })

    expect(lifecycle.kill9()).toMatchObject({ complete: false, exiting: [dying.pid] })
  })

  /**
   * ⛔ **A child that appears while the teardown is deciding what to kill** (333).
   *
   * ⚠️ `inspect()` is one `ps` per remembered pid times three fields — **81 ms on a seven-pid
   * lifecycle on an idle machine**, two to three times that under a full `pnpm run ci`. Discovery
   * used to happen once, ABOVE that call, so the app had the whole of it in which to spawn. And what
   * it spawns there is a provider CLI, which `codex-transport` starts `detached`: it leads its own
   * process group, so the group signal below never reaches it and only a `remember()` can.
   *
   * ⚑ Measured on a real `window:check`: **1 run in 70 had a descendant the lifecycle never owned**,
   * and the one `ENOTEMPTY` this dispatch reproduced left six Codex SQLite files behind, **written
   * 5 to 9 ms after the removal was asked**. The second discovery does not close that window — the
   * app is alive until the signal — but it shrinks it from an `inspect()` to a `ps -A`.
   */
  it('discovers a descendant that appears between the first scan and the signal', () => {
    const launcher = identity({ pid: 340, parentPid: 50, pgid: 340, command: 'pnpm launch' })
    const late = identity({
      pid: 341,
      parentPid: 340,
      // ⛔ Its OWN group, which is what `detached: true` buys a provider child — and what makes
      // `kill(-340)` miss it entirely.
      pgid: 341,
      command: '/repo/codex app-server',
    })
    const fake = fakeProcesses(launcher)
    const signals = []
    let scans = 0
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      killer: (pid, signal) => {
        signals.push([pid, signal])
        if (signal === 'SIGSTOP') return
        if (pid === -launcher.pid) fake.processes.delete(launcher.pid)
        if (pid === late.pid) fake.processes.delete(late.pid)
      },
      timers: { pause: () => {} },
      // The first scan is the one above `inspect()`; the app spawns during it, so only the second
      // scan — the one immediately before the signal — can see the child.
      discoverDescendants: () => {
        scans += 1
        if (scans === 1) return []
        fake.processes.set(late.pid, { ...late })
        return [{ pid: late.pid }]
      },
    })

    const result = lifecycle.kill9()

    expect(scans).toBeGreaterThanOrEqual(2)
    expect(signals).toContainEqual([late.pid, 'SIGKILL'])
    expect(result).toMatchObject({ complete: true, remaining: [], exiting: [] })
  })

  /**
   * 🔴 **360 · the freeze is what closes the window `333` could only shrink.**
   *
   * ⛔ **The app spawns while the teardown decides.** `333` moved the last scan to one `ps -A`
   * before the signal and wrote *"it does not close it"* — and at `cf87667` every `window:check`
   * launch spawns a `codex app-server` into the directory the check is about to remove, `detached`,
   * leading its own group. ⚑ **A stopped process runs no code**, so the order below is the whole
   * fix: `SIGSTOP` the group, and only THEN ask what is under it.
   *
   * ⚠️ **The fake spawns only while the tree is running**, which is the property being asserted. If
   * the freeze were removed, `scans` would still find the child on its second pass — the ordering,
   * not the count, is what this test is about, so it asserts the SIGSTOP lands before the scan that
   * finds the child and before any kill.
   */
  it('⛔ freezes the group BEFORE the scan that decides what it owns, and kills only after', () => {
    const launcher = identity({ pid: 360, parentPid: 50, pgid: 360, command: 'pnpm launch' })
    const late = identity({
      pid: 361,
      parentPid: 360,
      pgid: 361,
      command: '/repo/codex app-server',
    })
    const fake = fakeProcesses(launcher)
    const events = []
    let frozen = false
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer: (pid, signal) => {
        events.push(`${signal} ${String(pid)}`)
        if (signal === 'SIGSTOP') {
          if (pid === -launcher.pid) frozen = true
          return
        }
        fake.processes.delete(Math.abs(pid))
      },
      discoverDescendants: () => {
        events.push('scan')
        // ⛔ **A frozen tree spawns nothing.** Before the freeze this scan finds an empty tree; the
        // child exists only because the app was still running when the first pass ran.
        if (!frozen) return []
        fake.processes.set(late.pid, { ...late })
        return [{ pid: late.pid }]
      },
    })

    const result = lifecycle.kill9()

    // ⚑ The freeze is the FIRST thing, before any scan and before any kill.
    expect(events[0]).toBe(`SIGSTOP ${String(-launcher.pid)}`)
    expect(events.indexOf('scan')).toBe(1)
    // ⛔ …and the child the scan then found was frozen before it was killed, so it could not have
    // written a byte between being seen and being ended.
    expect(events.indexOf(`SIGSTOP ${String(late.pid)}`)).toBeLessThan(
      events.indexOf(`SIGKILL ${String(late.pid)}`),
    )
    expect(events.every((event, index) => !event.startsWith('SIGKILL') || index > 1)).toBe(true)
    expect(result).toMatchObject({ complete: true, refused: [], remaining: [] })
  })

  /**
   * ⛔ **360 · a child already remembered is frozen by pid, not left to the group signal.**
   *
   * ⚠️ **This is the one the group cannot reach.** `codex-transport` spawns `detached: true`, so the
   * child calls `setsid` and `kill(-launcher)` passes it by — it is only ever reached because a
   * `remember()` saved its identity. ⛔ If the freeze covered the group alone, the very process this
   * whole dispatch is about would keep running through the scan that was supposed to enumerate it.
   */
  it('⛔ freezes a remembered child in its OWN group, which the group signal never reaches', () => {
    const launcher = identity({ pid: 390, parentPid: 50, pgid: 390, command: 'pnpm launch' })
    const detached = identity({
      pid: 391,
      parentPid: 390,
      pgid: 391,
      command: '/repo/codex app-server',
    })
    const fake = fakeProcesses(launcher, detached)
    const events = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer: (pid, signal) => {
        events.push(`${signal} ${String(pid)}`)
        if (signal === 'SIGSTOP') return
        fake.processes.delete(Math.abs(pid))
      },
    })
    lifecycle.remember(detached.pid)

    lifecycle.kill9()

    // ⚑ Its own pid, positive — the group signal above it names -390 and this process is in 391.
    expect(events.indexOf(`SIGSTOP ${String(detached.pid)}`)).toBeGreaterThan(-1)
    expect(events.indexOf(`SIGSTOP ${String(detached.pid)}`)).toBeLessThan(
      events.indexOf(`SIGKILL ${String(detached.pid)}`),
    )
    expect(events).not.toContain(`SIGSTOP ${String(-detached.pid)}`)
  })

  /**
   * ⛔ **360 · the second pass, and it is the detached child's grandchild.**
   *
   * ⚠️ The group freeze does not reach a `detached` child, so between that signal and the pass that
   * freezes it by pid it is still running — and can spawn one of its own. ⚑ **One scan is therefore
   * not enough and two are owed**, which is the whole of why {@link FREEZE_PASSES} is not 1. Without
   * the loop the grandchild is never remembered, never frozen and never killed: it survives the
   * teardown and writes into the directory the caller is about to remove.
   */
  it('⛔ keeps scanning until a frozen tree stops producing processes', () => {
    const launcher = identity({ pid: 400, parentPid: 50, pgid: 400, command: 'pnpm launch' })
    const child = identity({
      pid: 401,
      parentPid: 400,
      pgid: 401,
      command: '/repo/codex app-server',
    })
    const grandchild = identity({ pid: 402, parentPid: 401, pgid: 401, command: 'codex sandbox' })
    const fake = fakeProcesses(launcher)
    const stopped = new Set()
    const killed = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer: (pid, signal) => {
        if (signal === 'SIGSTOP') {
          stopped.add(Math.abs(pid))
          return
        }
        killed.push(Math.abs(pid))
        fake.processes.delete(Math.abs(pid))
      },
      discoverDescendants: () => {
        // ⛔ The child appears once the LAUNCHER is frozen, and its own child only once the child
        // itself is — a tree that can still run is a tree that can still add to itself.
        if (stopped.has(launcher.pid)) fake.processes.set(child.pid, { ...child })
        if (stopped.has(child.pid)) fake.processes.set(grandchild.pid, { ...grandchild })
        return [...fake.processes.keys()]
          .filter((pid) => pid !== launcher.pid)
          .map((pid) => ({ pid }))
      },
    })

    const result = lifecycle.kill9()

    expect(killed).toContain(grandchild.pid)
    expect(result).toMatchObject({ complete: true, refused: [], remaining: [] })
  })

  /**
   * ⚑ **The control the test above needs**: the graceful ladder must never freeze. A stopped app
   * cannot run its own shutdown, and `quit:check` is the gate that measures exactly that.
   */
  it('⚑ …and `stop()` never freezes anything, because a frozen app cannot quit', () => {
    const launcher = identity({ pid: 365, parentPid: 50, pgid: 365, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer: (pid, signal) => {
        signals.push(signal)
        if (signal !== 'SIGSTOP') fake.processes.delete(Math.abs(pid))
      },
    })

    expect(lifecycle.stop()).toMatchObject({ complete: true, refused: [] })
    expect(signals).toEqual(['SIGTERM'])
  })

  /**
   * ⛔ **360 · a freeze the kernel refuses is the third answer, and it stops the removal.**
   *
   * ⚠️ **`unsignallable` is not `gone`.** `ps` answered `alive` and the kill was refused, so the
   * scan below cannot be trusted — a child spawned behind it would be invisible. ⛔ Reporting that
   * as a complete teardown is exactly what let a directory come off underneath a live writer.
   */
  it('⛔ refuses to call a teardown complete when the tree could not be frozen', () => {
    const launcher = identity({ pid: 370, parentPid: 50, pgid: 370, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      attempts: 1,
      killer: (pid, signal) => {
        if (signal === 'SIGSTOP') {
          throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
        }
        fake.processes.delete(Math.abs(pid))
      },
    })

    const result = lifecycle.kill9()

    // ⚑ Every pid list is EMPTY and it is still not complete: nothing is running, and the question
    // of what was running could not be asked.
    expect(result).toMatchObject({ complete: false, remaining: [], exiting: [], unverifiable: [] })
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0]).toContain('unsignallable (EPERM)')
    expect(result.refused[0]).toContain('could not be frozen')
  })

  /**
   * ⚑ **A launch that has already ENDED is not a refusal**, and this is the pair the test above
   * needs: `gone` cannot spawn anything, so there is nothing to freeze and nothing to refuse. ⛔
   * Without it, the rule above would be satisfied by a teardown that refuses on every path — which
   * is a gate nobody can ever get green.
   */
  it('⚑ …and a launcher that is already gone is nothing to freeze, not something refused', () => {
    const launcher = identity({ pid: 375, parentPid: 50, pgid: 375, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer: (pid, signal) => signals.push(signal),
    })
    fake.processes.delete(launcher.pid)

    expect(lifecycle.kill9()).toMatchObject({ complete: true, refused: [] })
    expect(signals).toEqual([])
  })

  /**
   * ⛔ **360 · a tree that will not settle is refused rather than chased.**
   *
   * ⚠️ Each pass freezes what the last one found, so a tree that keeps producing new pids is one
   * where the freeze is not holding — and going round again is the retry loop `owned-teardown.mjs`
   * exists to refuse. ⚑ The bound is named in the sentence, so a reader knows it was a bound.
   */
  it('⛔ refuses when the scan keeps finding processes nobody has frozen', () => {
    const launcher = identity({ pid: 380, parentPid: 50, pgid: 380, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    let next = 381
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      attempts: 1,
      killer: (pid, signal) => {
        if (signal === 'SIGSTOP') return
        fake.processes.delete(Math.abs(pid))
      },
      discoverDescendants: () => {
        const pid = next++
        fake.processes.set(pid, {
          ...identity({
            pid,
            parentPid: launcher.pid,
            pgid: pid,
            command: `spawner ${String(pid)}`,
          }),
        })
        return [{ pid }]
      },
    })

    const result = lifecycle.kill9()

    expect(result.complete).toBe(false)
    expect(result.refused).toEqual([
      'the descendant scan was still finding processes nobody had frozen after 5 passes, so this ' +
        'teardown cannot say what it owns',
    ])
  })

  it('a foreign parent alone does not withdraw authority to WAIT — only to signal', () => {
    const launcher = identity({ pid: 320, parentPid: 50, pgid: 320, command: 'pnpm launch' })
    const child = identity({ pid: 321, parentPid: 320, pgid: 320, command: 'Electron owned' })
    const fake = fakeProcesses(launcher, child)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      killer: (pid, signal) => signals.push([pid, signal]),
      timers: { pause: () => {} },
      attempts: 2,
    })
    lifecycle.remember(child.pid)

    fake.processes.delete(launcher.pid)
    fake.processes.set(child.pid, { ...child, parentPid: 777 })

    // Same pid, same start: it is the process we launched, whatever `ps` now says its parent is.
    expect(lifecycle.stop()).toMatchObject({ complete: false, exiting: [child.pid] })
    expect(signals).toEqual([])
  })

  it('uses a positive pid, never a process group, when the launcher is not its group leader', () => {
    const launcher = identity({ pid: 400, parentPid: 50, pgid: 40, command: 'attached launcher' })
    const fake = fakeProcesses(launcher)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer(pid, signal) {
        signals.push([pid, signal])
        fake.processes.delete(pid)
      },
    })

    expect(lifecycle.stop().complete).toBe(true)
    expect(signals).toEqual([[launcher.pid, 'SIGTERM']])
    expect(signals.some(([pid]) => pid < 0)).toBe(false)
  })

  it('tears down only identities remembered while ownership was established', () => {
    const launcher = identity({ pid: 500, parentPid: 50, pgid: 500, command: 'pnpm launch' })
    const listener = identity({ pid: 501, parentPid: 500, pgid: 500, command: 'Electron owned' })
    const historicalPortOwner = identity({
      pid: 599,
      parentPid: 42,
      pgid: 42,
      command: 'unrelated app now using the old port',
    })
    const fake = fakeProcesses(launcher, listener, historicalPortOwner)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer(pid, signal) {
        signals.push([pid, signal])
        if (pid === -launcher.pid) fake.processes.delete(launcher.pid)
        if (pid === listener.pid) fake.processes.delete(listener.pid)
      },
    })
    lifecycle.remember(listener.pid)
    fake.reads.length = 0

    expect(lifecycle.stop().complete).toBe(true)
    expect(signals).toEqual([
      [-launcher.pid, 'SIGTERM'],
      [listener.pid, 'SIGTERM'],
    ])
    expect(fake.reads).not.toContain(historicalPortOwner.pid)

    const source = readFileSync(join(HERE, '../lib/owned-process.mjs'), 'utf8')
    expect(source).not.toContain("execFileSync('lsof'")
  })

  it('keeps its exit retry armed when identity is unverifiable, then kill9 completes safely', () => {
    const launcher = identity({ pid: 600, parentPid: 50, pgid: 600, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const events = new EventEmitter()
    const signals = []
    const pauses = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: events,
      attempts: 2,
      intervalMs: 17,
      timers: { pause: (milliseconds) => pauses.push(milliseconds) },
      killer(pid, signal) {
        signals.push([pid, signal])
        if (signal === 'SIGSTOP') return
        fake.processes.delete(Math.abs(pid))
      },
    })
    fake.unreadable.add(launcher.pid)

    expect(lifecycle.stop()).toEqual({
      complete: false,
      signals: 0,
      remaining: [],
      exiting: [],
      unverifiable: [launcher.pid],
      refused: [],
    })
    expect(pauses).toEqual([17])
    expect(signals).toEqual([])
    expect(events.listenerCount('exit')).toBe(1)
    expect(lifecycle.armed).toBe(true)

    fake.unreadable.delete(launcher.pid)
    const completed = lifecycle.kill9()
    expect(completed.complete).toBe(true)
    expect(signals).toEqual([
      [-launcher.pid, 'SIGSTOP'],
      [-launcher.pid, 'SIGKILL'],
    ])
    expect(events.listenerCount('exit')).toBe(0)
    expect(lifecycle.kill9()).toBe(completed)
    // ⚑ Two, and still no MORE than two: the memoized result signals nothing a second time — the
    // freeze rides inside the same teardown rather than becoming a separate gesture (360).
    expect(signals).toHaveLength(2)
  })

  it('rolls back only newly discovered identities when launcher provenance changes', () => {
    const launcher = identity({ pid: 650, parentPid: 50, pgid: 650, command: 'pnpm launch' })
    const proven = identity({ pid: 651, parentPid: 650, pgid: 650, command: 'Electron proven' })
    const transient = identity({ pid: 652, parentPid: 650, pgid: 650, command: 'helper transient' })
    const fake = fakeProcesses(launcher, proven, transient)
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      discoverDescendants() {
        // Discovery began under the captured launcher, but its pid changed hands before the
        // post-discovery provenance check. Only identities learned in this window are suspect.
        fake.processes.set(launcher.pid, { ...launcher, start: 'replacement launcher' })
        return [transient.pid]
      },
    })
    lifecycle.remember(proven.pid)

    expect(lifecycle.refreshDescendants()).toBe(false)
    expect(lifecycle.identities.map(({ pid }) => pid)).toEqual([launcher.pid, proven.pid])
  })

  it('does not forget failed discovery after the launcher is gone', () => {
    const launcher = identity({ pid: 670, parentPid: 50, pgid: 670, command: 'pnpm launch' })
    const fake = fakeProcesses(launcher)
    const events = new EventEmitter()
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: events,
      attempts: 1,
      timers: { pause: () => {} },
      discoverDescendants() {
        throw new Error('process tree unreadable')
      },
      killer(pid, signal) {
        signals.push([pid, signal])
        fake.processes.delete(Math.abs(pid))
      },
    })

    expect(lifecycle.stop()).toEqual({
      complete: false,
      signals: 1,
      remaining: [],
      exiting: [],
      unverifiable: [launcher.pid],
      refused: [],
    })
    expect(events.listenerCount('exit')).toBe(1)
    expect(lifecycle.stop()).toEqual({
      complete: false,
      signals: 0,
      remaining: [],
      exiting: [],
      unverifiable: [launcher.pid],
      refused: [],
    })
    expect(events.listenerCount('exit')).toBe(1)
    expect(signals).toEqual([[-launcher.pid, 'SIGTERM']])
  })

  it('keeps discovery uncertainty sticky after a later readable scan', () => {
    const launcher = identity({ pid: 675, parentPid: 50, pgid: 675, command: 'stable launcher' })
    const fake = fakeProcesses(launcher)
    const events = new EventEmitter()
    let readable = false
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: events,
      discoverDescendants() {
        if (!readable) throw new Error('temporary process tree failure')
        return []
      },
    })

    expect(lifecycle.refreshDescendants()).toBe(false)
    readable = true
    expect(lifecycle.refreshDescendants()).toBe(false)
    fake.processes.delete(launcher.pid)
    expect(lifecycle.stop()).toEqual({
      complete: false,
      signals: 0,
      remaining: [],
      exiting: [],
      unverifiable: [launcher.pid],
      refused: [],
    })
    expect(events.listenerCount('exit')).toBe(1)
  })

  it('captures late descendants before a graceful launcher signal', () => {
    const launcher = identity({ pid: 680, parentPid: 50, pgid: 680, command: 'pnpm launch' })
    const provider = identity({
      pid: 681,
      parentPid: 680,
      pgid: 681,
      command: 'provider detached child',
    })
    const fake = fakeProcesses(launcher, provider)
    const signals = []
    const lifecycle = createOwnedProcessLifecycle({
      launcherPid: launcher.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      discoverDescendants: () => [provider.pid],
      killer(pid, signal) {
        signals.push([pid, signal])
        if (pid === -launcher.pid) {
          fake.processes.delete(launcher.pid)
          fake.processes.set(provider.pid, { ...provider, parentPid: 1 })
        }
        if (pid === provider.pid) fake.processes.delete(provider.pid)
      },
    })

    expect(lifecycle.signal('SIGINT')).toBe(true)
    expect(lifecycle.identities.map(({ pid }) => pid)).toEqual([launcher.pid, provider.pid])
    expect(lifecycle.stop().complete).toBe(true)
    expect(signals).toEqual([
      [-launcher.pid, 'SIGINT'],
      [provider.pid, 'SIGTERM'],
    ])
  })

  /**
   * 🔴 **The refusal has to name the state it refused on** (345 §2, from 342's step 38).
   *
   * ⛔ **`signal` answers a boolean, and `342` paid for it.** The only step in `smoke:ui` that
   * signals one launch twice died on *"its saved process identity no longer matches"* — a sentence
   * that is true of exactly one of the six ways this can decline, and false of the one the evidence
   * pointed at (a launcher that had simply finished). ⚑ **Each arm below is a DIFFERENT sentence**,
   * which is the whole claim: a shared one would make this pass over the defect it exists to remove.
   */
  describe('…and says which state it refused on', () => {
    const twoStates = (mutate) => {
      const launcher = identity({ pid: 900, parentPid: 1, pgid: 900, command: 'launcher' })
      const fake = fakeProcesses(launcher)
      const lifecycle = createOwnedProcessLifecycle({
        launcherPid: launcher.pid,
        readIdentity: fake.readIdentity,
        eventEmitter: new EventEmitter(),
        timers: { pause: () => {} },
        killer: () => {},
      })
      mutate(fake, launcher)
      return lifecycle.signalWhy('SIGINT')
    }

    it('⚑ says `sent` when it really signalled — the control the refusals differ from', () => {
      expect(twoStates(() => {})).toEqual({ signalled: true, why: 'sent' })
    })

    /**
     * ⚠️ **`exiting` and `replaced` are separated by `start`, not by the command.** The same pid
     * with a different command line is still the process authority was saved for — mid-teardown —
     * and only a different `lstart` means the number changed hands. Getting that wrong is what the
     * first draft of this test did, and it is the distinction the whole block is about.
     */
    const REFUSALS = [
      ['gone', (fake, launcher) => fake.processes.delete(launcher.pid)],
      [
        'collected',
        (fake, launcher) => fake.processes.set(launcher.pid, { ...launcher, runState: 'Z' }),
      ],
      [
        'exiting',
        (fake, launcher) =>
          fake.processes.set(launcher.pid, {
            ...launcher,
            command: 'the same process, tearing down',
          }),
      ],
      [
        'replaced',
        (fake, launcher) =>
          fake.processes.set(launcher.pid, { ...launcher, start: 'a whole new process here' }),
      ],
      ['unverifiable', (fake, launcher) => fake.unreadable.add(launcher.pid)],
    ]

    /**
     * ⛔ **`ps` said alive and the KERNEL said no** — its own state since 345's review, which
     * measured it reporting as `unverifiable`, byte-identical to a `ps` that could not be read. The
     * errno is carried into the sentence because it is the only refusal that has one.
     */
    it('⛔ a signal the kernel refuses is not reported as a ps that could not be asked', () => {
      const launcher = identity({ pid: 930, parentPid: 1, pgid: 930, command: 'launcher' })
      const fake = fakeProcesses(launcher)
      const lifecycle = createOwnedProcessLifecycle({
        launcherPid: launcher.pid,
        readIdentity: fake.readIdentity,
        eventEmitter: new EventEmitter(),
        timers: { pause: () => {} },
        killer: () => {
          throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
        },
      })
      const refused = lifecycle.signalWhy('SIGINT')
      expect(refused).toEqual({
        signalled: false,
        why: 'the launcher reads unsignallable, not alive (ESRCH)',
      })
      expect(refused.why).not.toBe(twoStates((f, l) => f.unreadable.add(l.pid)).why)
    })

    // ⚠️ `startsWith`, not equality: the two refusals that carry an errno append it, and that detail
    // is the whole content of an `unsignallable`. The kind is what this row is about.
    it.each(REFUSALS)('⛔ a launcher that reads %s is refused in those words', (kind, mutate) => {
      const result = twoStates(mutate)
      expect(result.signalled).toBe(false)
      expect(result.why.startsWith(`the launcher reads ${kind}, not alive`), result.why).toBe(true)
    })

    /**
     * ⛔ **No two of them may read alike, and nothing else says so.** A supervisor that finished, a
     * zombie row, a process mid-teardown, a pid that changed hands and a `ps` that could not be
     * asked are five different answers to *"why did step 38 not get its second signal"*; the
     * sentence `342` met collapsed all five into the fourth one's words.
     */
    it('⛔ the five refusals are five distinct sentences', () => {
      const said = REFUSALS.map(([, mutate]) => twoStates(mutate).why)
      expect(new Set(said).size).toBe(REFUSALS.length)
    })

    it('⛔ an untrustworthy descendant re-scan is named as such, with the launcher beside it', () => {
      const launcher = identity({ pid: 910, parentPid: 1, pgid: 910, command: 'launcher' })
      const fake = fakeProcesses(launcher)
      const lifecycle = createOwnedProcessLifecycle({
        launcherPid: launcher.pid,
        readIdentity: fake.readIdentity,
        eventEmitter: new EventEmitter(),
        timers: { pause: () => {} },
        discoverDescendants: () => {
          throw new Error('ps went away mid-scan')
        },
        killer: () => {},
      })
      const result = lifecycle.signalWhy('SIGINT')
      expect(result.signalled).toBe(false)
      expect(result.why).toBe(
        'the descendant re-scan could not be trusted, and the launcher reads alive',
      )
    })

    it('⚑ `signal` still answers a plain boolean, because every caller tests it as one', () => {
      const launcher = identity({ pid: 920, parentPid: 1, pgid: 920, command: 'launcher' })
      const fake = fakeProcesses(launcher)
      const lifecycle = createOwnedProcessLifecycle({
        launcherPid: launcher.pid,
        readIdentity: fake.readIdentity,
        eventEmitter: new EventEmitter(),
        timers: { pause: () => {} },
        killer: () => {},
      })
      expect(lifecycle.signal('SIGINT')).toBe(true)
      fake.processes.delete(launcher.pid)
      expect(lifecycle.signal('SIGINT')).toBe(false)
    })

    /**
     * 🔴 **722 · step 38's second quit reaches the APP once its launcher has gone** (`717` F-3).
     * ⛔ The launcher exits with `pnpm`, milliseconds into the first quit, while the app is still
     * shutting down with its parent gone. `signalWhy` can only say `gone` there — what five batches
     * printed — and `signalRememberedWhy` reaches the app by the identity saved while it was
     * provably ours, refuses a pid that changed hands, and refuses one it never saved.
     */
    it('⚑ 722 · reaches the remembered app once its launcher is gone, and nothing it never saved', () => {
      const launcher = identity({ pid: 940, parentPid: 1, pgid: 940, command: 'launcher' })
      const app = identity({ pid: 941, parentPid: 940, pgid: 940, command: 'Electron --app' })
      const fake = fakeProcesses(launcher, app)
      const signals = []
      const lifecycle = createOwnedProcessLifecycle({
        launcherPid: launcher.pid,
        readIdentity: fake.readIdentity,
        eventEmitter: new EventEmitter(),
        timers: { pause: () => {} },
        killer: (pid, signal) => signals.push([pid, signal]),
      })
      lifecycle.remember(app.pid)
      fake.processes.delete(launcher.pid)
      fake.processes.set(app.pid, { ...app, parentPid: 1 })

      expect(lifecycle.signalWhy('SIGINT').why).toBe('the launcher reads gone, not alive')
      expect(lifecycle.signalRememberedWhy(app.pid, 'SIGINT')).toEqual({
        signalled: true,
        why: 'sent',
      })
      fake.processes.set(app.pid, { ...app, parentPid: 1, start: 'a whole new process here' })
      expect(lifecycle.signalRememberedWhy(app.pid, 'SIGINT')).toEqual({
        signalled: false,
        why: `pid ${app.pid} reads replaced, not alive`,
      })
      expect(lifecycle.signalRememberedWhy(launcher.pid, 'SIGINT').why).toBe(
        `pid ${launcher.pid} is not a process this launch remembered`,
      )
      expect(signals).toEqual([[app.pid, 'SIGINT']])

      // ⚑ And step 38 aims its second signal there: one to the launch's group, then one to the app.
      const smoke = readFileSync(join(HERE, '../ui-live-smoke.mjs'), 'utf8')
      expect(smoke).toMatch(
        /own\.signal\('SIGINT'\)\s+await sleep\(50\)\s+own\.signalApp\('SIGINT'\)/,
      )
    })
  })

  it('⛔ a same-port contender cannot adopt or signal the incumbent listener', () => {
    const incumbent = identity({ pid: 700, parentPid: 50, pgid: 700, command: 'incumbent launch' })
    const listener = identity({
      pid: 701,
      parentPid: 700,
      pgid: 700,
      command: 'incumbent Electron',
    })
    const contender = identity({ pid: 800, parentPid: 50, pgid: 800, command: 'contender launch' })
    const fake = fakeProcesses(incumbent, listener, contender)
    const signals = []
    const second = createOwnedProcessLifecycle({
      launcherPid: contender.pid,
      readIdentity: fake.readIdentity,
      eventEmitter: new EventEmitter(),
      timers: { pause: () => {} },
      killer(pid, signal) {
        signals.push([pid, signal])
        if (pid === -contender.pid) fake.processes.delete(contender.pid)
      },
    })

    expect(() => second.remember(listener.pid)).toThrow(/neither a saved descendant/)
    expect(second.stop().complete).toBe(true)
    expect(signals).toEqual([[-contender.pid, 'SIGTERM']])
    expect(fake.processes.has(incumbent.pid)).toBe(true)
    expect(fake.processes.has(listener.pid)).toBe(true)
  })

  it('wires launchApp through saved identities, including the spawn-only contender path', () => {
    const source = readFileSync(join(HERE, '../ui-live-smoke.mjs'), 'utf8')
    const supervisor = readFileSync(join(HERE, '../lib/owned-launcher.mjs'), 'utf8')
    const launch = source.slice(
      source.indexOf('async function launchApp('),
      source.indexOf('/**\n * ⛔ **`fetch` with a deadline**'),
    )

    expect(launch).toContain('createOwnedProcessLifecycle({')
    expect(launch).toContain("process.execPath,\n    [\n      OWNED_LAUNCHER,\n      'pnpm'")
    expect(launch).toMatch(
      /let lifecycle = null[\s\S]*createOwnedProcessLifecycle\([\s\S]*await claimOwnedLauncher\(child\)[\s\S]*catch \(error\) \{\s*if \(lifecycle\) lifecycle\.stop\(\)\s*if \(child\.connected\) child\.disconnect\(\)/,
    )
    expect(launch).toContain('if (contender) return handle')
    expect(launch).toMatch(
      /if \(contender\) return handle\s+try \{[\s\S]*\} catch \(error\) \{\s*stop\(\)\s*throw error\s*\}\s*return handle/,
    )
    expect(launch).toMatch(/withinLiveDeadline\([\s\S]*onDeadline: stop/)
    expect(launch).not.toContain("process.on('exit', stop)")
    expect(launch).not.toContain("execFileSync('lsof'")
    expect(source).toMatch(/user-data-sole-instance[\s\S]*contender: true/)
    expect(supervisor).toContain("process.kill(-process.pid, 'SIGKILL')")
    expect(supervisor).toContain("process.once('disconnect', failClosed)")
    expect(supervisor).toContain("process.on('SIGINT', () => {})")
    expect(supervisor).toContain("process.on('SIGTERM', () => {})")
  })
})
