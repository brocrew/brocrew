// Frozen 0.1.8 lock reader; unused durable writer and internal exports omitted.
/** A filesystem bakery mutex. Each contender owns an immutable, unique name. No stale
 * callback can unlink a successor, and a crash before writing a ticket remains attributable.
 * Only short synchronous metadata transactions run inside this mutex. */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { privateFolder } from '../../src/privatePaths.js'
type Liveness = 'alive' | 'gone' | 'unknown'
export interface ProcessIdentity {
  pid: number
  birth: string
}
export function birthOf(pid: number): string | undefined {
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]
    }
    const args =
      process.platform === 'win32'
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
          ]
        : ['-p', String(pid), '-o', 'lstart=']
    const out = execFileSync(process.platform === 'win32' ? 'powershell' : 'ps', args, {
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
function ownerState(owner: ProcessIdentity): Liveness {
  try {
    process.kill(owner.pid, 0)
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown'
  }
  const birth = birthOf(owner.pid)
  return birth === undefined ? 'unknown' : birth === owner.birth ? 'alive' : 'gone'
}
export const identity = (): ProcessIdentity => {
  const birth = birthOf(process.pid)
  if (!birth) throw new Error('Cannot confirm plugin process identity; try again.')
  return { pid: process.pid, birth }
}
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
export function withSharedLock<T>(
  root: string,
  owner: ProcessIdentity,
  fn: () => T,
  timeout = 2000,
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
        privateFolder(locks, path.join(locks, name))
        const stat = fs.lstatSync(path.join(locks, name, 'ticket'))
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid registry ticket')
        ticket = Number(fs.readFileSync(path.join(locks, name, 'ticket'), 'utf8'))
        if (!Number.isSafeInteger(ticket) || ticket < 1) throw new Error('Invalid registry ticket')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        // A contender can finish between readdir, lstat and realpath. Its unique
        // directory cannot become a successor, so absence is safe to skip. An
        // existing directory without a ticket is still choosing and stays blocking.
        try {
          fs.lstatSync(path.join(locks, name))
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
    for (;;) {
      const blocked = contenders().some(
        (c) =>
          c.token !== token &&
          (c.ticket === null || c.ticket < number || (c.ticket === number && c.token < token)),
      )
      if (!blocked) return fn()
      if (Date.now() >= end) throw new Error('Shared Chrome registry busy; try again.')
      pause()
    }
  } finally {
    fs.rmSync(mine, { recursive: true, force: true })
  }
}
