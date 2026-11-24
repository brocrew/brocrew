/** A filesystem bakery mutex. Each contender owns an immutable, unique name. No stale
 * callback can unlink a successor, and a crash before writing a ticket remains attributable.
 * Only short synchronous metadata transactions run inside this mutex. */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { retry, writeAtomicallySync } from '../../../shared/atomic-file.js'
import { privateFolder } from '../privatePaths.js'
import { windowsBirthOf } from './windowsBirth.js'
export type Liveness = 'alive' | 'gone' | 'unknown'
export interface ProcessIdentity {
  pid: number
  birth: string
}
export function birthOf(pid: number): string | undefined {
  try {
    if (process.platform === 'win32') return windowsBirthOf(pid)
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]
    }
    const args = ['-p', String(pid), '-o', 'lstart=']
    const out = execFileSync('ps', args, {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    }).trim()
    return out || undefined
  } catch {
    return undefined
  }
}
export function ownerState(owner: ProcessIdentity): Liveness {
  try {
    process.kill(owner.pid, 0)
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown'
  }
  const birth = birthOf(owner.pid)
  return birth === undefined ? 'unknown' : birth === owner.birth ? 'alive' : 'gone'
}
export const identity = (): ProcessIdentity => {
  const birth = process.platform === 'win32' ? windowsBirthOf(process.pid) : birthOf(process.pid)
  if (!birth) throw new Error('Cannot confirm plugin process identity; try again.')
  return { pid: process.pid, birth }
}
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
const busy = () => new Error('Shared Chrome registry busy; try again.')
/** Without a process birth there is no exit to wait for, so a contender that could not be
 * identified, even once, is kept but waited on only this long from then. */
const UNIDENTIFIED_WAIT_MS = 2000
/** On Windows each liveness answer starts a program, so contenders are asked a few times a second. */
const ASK_AGAIN_MS = 250
/** Waits while a contender ahead lives: what runs inside is a short metadata transaction, so
 * one is done when it leaves or its process exits, however slow the machine. A caller may bound
 * its own wait. */
export function withSharedLock<T>(
  root: string,
  owner: ProcessIdentity,
  fn: () => T,
  timeout = Infinity,
): T {
  const locks = privateFolder(root, path.join(root, 'registry.lock'), true)
  const token = `${owner.pid}.${Buffer.from(owner.birth).toString('base64url')}.${randomUUID()}`
  const mine = path.join(locks, token)
  fs.mkdirSync(mine, { mode: 0o700 }) // Choosing=true, with owner identity already in the name.
  const end = Date.now() + timeout
  const observed = new Map<string, Liveness>()
  const contenders = (): Array<{ token: string; ticket: number | null }> => {
    const found: Array<{ token: string; ticket: number | null }> = []
    for (const name of fs.readdirSync(locks)) {
      const match = /^(\d+)\.([A-Za-z0-9_-]+)\.([a-f0-9-]{36})$/.exec(name)
      if (!match) throw new Error('Shared Chrome registry lock needs attention.')
      let state = observed.get(name)
      if (state === undefined) {
        const other = {
          pid: Number(match[1]),
          birth: Buffer.from(match[2], 'base64url').toString(),
        }
        state = other.pid === owner.pid && other.birth === owner.birth ? 'alive' : ownerState(other)
        observed.set(name, state)
      }
      if (name !== token && state === 'gone') {
        // Unique names are never reused. Removing this dead contender cannot remove a successor.
        fs.rmSync(path.join(locks, name), { recursive: true, force: true })
        continue
      }
      let ticket: number | null = null
      try {
        // Windows refuses to open a ticket while its owner deletes it; that ends with the delete.
        ticket = retry(() => {
          privateFolder(locks, path.join(locks, name))
          const stat = fs.lstatSync(path.join(locks, name, 'ticket'))
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid registry ticket')
          const value = Number(fs.readFileSync(path.join(locks, name, 'ticket'), 'utf8'))
          if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid registry ticket')
          return value
        })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        // A contender can finish between readdir, lstat and realpath. Its unique
        // directory cannot become a successor, so absence is safe to skip. An
        // existing directory without a ticket is still choosing and stays blocking.
        try {
          retry(() => fs.lstatSync(path.join(locks, name)))
        } catch (absent) {
          if ((absent as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw absent
        }
      }
      found.push({ token: name, ticket })
    }
    return found
  }
  try {
    const number = Math.max(0, ...contenders().map((c) => c.ticket ?? 0)) + 1
    const temp = path.join(mine, 'choosing')
    fs.writeFileSync(temp, String(number), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temp, path.join(mine, 'ticket'))
    let asked = Date.now()
    const unidentified = new Map<string, number>()
    for (;;) {
      const ahead = contenders().filter(
        (c) =>
          c.token !== token &&
          (c.ticket === null || c.ticket < number || (c.ticket === number && c.token < token)),
      )
      if (ahead.length === 0) return fn()
      const now = Date.now()
      if (now >= end) throw busy()
      for (const c of ahead)
        if (observed.get(c.token) === 'unknown' && !unidentified.has(c.token))
          unidentified.set(c.token, now)
      if (ahead.some((c) => now - (unidentified.get(c.token) ?? now) >= UNIDENTIFIED_WAIT_MS))
        throw busy()
      if (now - asked >= ASK_AGAIN_MS) {
        for (const c of ahead) observed.delete(c.token)
        asked = now
      }
      pause()
    }
  } finally {
    fs.rmSync(mine, { recursive: true, force: true })
  }
}
/** Durable replace, keeping arbitrary unknown fields in the caller's object. */
export function durableJson(file: string, value: unknown): void {
  writeAtomicallySync(file, JSON.stringify(value) + '\n')
}
