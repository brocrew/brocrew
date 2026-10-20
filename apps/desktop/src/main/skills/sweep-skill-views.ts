import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { hostname } from 'node:os'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setImmediate } from 'node:timers/promises'
import { withProviderHomeLock, trustProviderHomeAncestry } from '@brobot2/runtime/provider-home'

const VIEW_NAME = /^brobot-skills-[a-f0-9]{64}-[A-Za-z0-9]{6}$/
const OWNER = '.brobot-skills-owner.json'
const leases = new Map<string, { active: boolean; dev: number; ino: number }>()
const sweeps = new Map<string, Promise<void>>()
// Leave headroom below 50 ms, and also cap work when the clock has coarse resolution. Each step
// visits or removes one entry, never a whole copy. A single filesystem call can still be slow.
const SLICE_MS = 10
const SLICE_STEPS = 8

/** Called under the home lock, before publishing the view to a provider. */
export function retainSkillView(root: string, until?: Promise<void>): void {
  writeFileSync(join(root, OWNER), JSON.stringify({ host: hostname(), pid: process.pid }), {
    flag: 'wx',
    mode: 0o600,
  })
  const { dev, ino } = lstatSync(root)
  const lease = { active: true, dev, ino }
  leases.set(root, lease)
  // Absence of a lifetime means process lifetime. Cancellation or changed grants alone do not
  // prove a provider stopped; the runtime supplies Launch.settled, including slow teardown tails.
  void until?.then(
    () => {
      lease.active = false
    },
    () => {
      /* An uncertain termination keeps its copy. */
    },
  )
}

function stillUsed(root: string, stat: Stats): boolean {
  const lease = leases.get(root)
  if (lease) return lease.dev !== stat.dev || lease.ino !== stat.ino || lease.active
  let fd: number
  try {
    fd = openSync(
      join(root, OWNER),
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false // pre-lease copy
    return true
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 1024) return true
    const bytes = Buffer.alloc(1025)
    const count = readSync(fd, bytes, 0, bytes.length, 0)
    if (count !== stat.size || count > 1024) return true
    const owner: unknown = JSON.parse(bytes.subarray(0, count).toString('utf8'))
    if (typeof owner !== 'object' || owner === null || !('host' in owner) || !('pid' in owner))
      return true
    if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0)
      return true
    try {
      process.kill(Number(owner.pid), 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  } catch {
    return true
  } finally {
    closeSync(fd)
  }
}

// Only trees the installer can create are eligible. Unknown additions, links, mounts and other
// objects keep the whole copy. Even a matching basename never authorizes an arbitrary tree walk.
const DIRECTORY =
  /^(?:claude-plugin(?:\/(?:\.claude-plugin|skills(?:\/[a-z][a-z0-9-]{0,63})?))?|codex(?:\/skills(?:\/[a-z][a-z0-9-]{0,63})?)?)$/
const FILE =
  /^(?:\.brobot-skills-owner\.json|claude-plugin\/\.claude-plugin\/plugin\.json|(?:claude-plugin|codex)\/skills\/[a-z][a-z0-9-]{0,63}\/SKILL\.md)$/

interface Entry {
  path: string
  stat: Stats
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode

function* removeView(managedRoot: string, root: string, rootStat: Stats): Generator<void> {
  const entries: Entry[] = []
  if (!same(rootStat, lstatSync(root))) throw new Error('Old skill view was replaced.')
  const collect = function* (path: string, relative: string): Generator<void> {
    const pin = trustProviderHomeAncestry(managedRoot, path, { includeLeaf: true })
    try {
      pin.verify()
      const directory = lstatSync(path)
      if (directory.dev !== rootStat.dev) throw new Error('Mounted skill directory.')
      // Read one directory entry at a time: a large selected-skills folder must not become one
      // unbounded synchronous readdir/collection step. At most the whitelisted depth stays open.
      const directoryEntries = opendirSync(path, { bufferSize: 1 })
      try {
        yield
        for (;;) {
          pin.verify()
          const entry = directoryEntries.readSync()
          if (!entry) break
          const child = join(path, entry.name)
          const local = relative ? `${relative}/${entry.name}` : entry.name
          const stat = lstatSync(child)
          if (stat.isDirectory() && DIRECTORY.test(local)) yield* collect(child, local)
          else if (stat.isFile() && stat.nlink === 1 && FILE.test(local)) {
            entries.push({ path: child, stat })
            yield
          } else throw new Error('Unexpected object in old skill view.')
        }
      } finally {
        directoryEntries.closeSync()
      }
      pin.verify()
      entries.push({ path, stat: directory }) // children before their parent
    } finally {
      pin.release()
    }
  }
  yield* collect(root, '')
  // No recursive rm: each parent is pinned and rechecked, and every removal addresses the exact
  // snapshotted entry. A linked directory is never traversed or adopted as an old installation.
  for (const entry of entries) {
    const pin = trustProviderHomeAncestry(managedRoot, dirname(entry.path), { includeLeaf: true })
    try {
      pin.verify()
      const now = lstatSync(entry.path)
      if (!same(now, entry.stat)) throw new Error('Old skill view was replaced.')
      if (now.isDirectory()) rmdirSync(entry.path)
      else unlinkSync(entry.path)
    } finally {
      pin.release()
    }
    if (entry.path !== root) yield
  }
  leases.delete(root)
}

async function sweep(managedRoot: string, home: string, current: string): Promise<void> {
  const pin = trustProviderHomeAncestry(managedRoot, home, { includeLeaf: true })
  try {
    pin.verify()
    const homeDevice = lstatSync(home).dev
    // The home listing runs off-thread and is finite even while launches add fresh views.
    const names = await readdir(home)
    for (const name of names) {
      await setImmediate()
      if (!VIEW_NAME.test(name)) continue
      const root = join(home, name)
      if (root === current) continue
      let removal: Generator<void> | undefined
      let viewPin: ReturnType<typeof trustProviderHomeAncestry> | undefined
      let stat: Stats | undefined
      let done = false
      try {
        while (!done) {
          await withProviderHomeLock(
            home,
            () => {
              const started = performance.now()
              pin.verify()
              if (!stat) {
                stat = lstatSync(root)
                if (!stat.isDirectory() || stat.dev !== homeDevice) {
                  done = true
                  return
                }
                viewPin = trustProviderHomeAncestry(managedRoot, root, { includeLeaf: true })
                removal = removeView(managedRoot, root, stat)
              }
              viewPin!.verify()
              // A yield also releases the home lock. Recheck ownership and the original view's
              // identity on every reacquisition before continuing its scan or deleting anything.
              if (stillUsed(root, stat)) {
                done = true
                return
              }
              for (let step = 0; step < SLICE_STEPS; step++) {
                if (step > 0 && performance.now() - started >= SLICE_MS) break
                if (removal!.next().done) {
                  done = true
                  break
                }
              }
            },
            { verify: () => pin.verify() },
          )
          // Never hold the home lock across a yield: another launch can publish between slices.
          if (!done) await setImmediate()
        }
      } catch {
        // Cleanup is best effort. A replacement or uncertain tree must not block a new launch.
      } finally {
        try {
          removal?.return(undefined)
        } finally {
          viewPin?.release()
        }
      }
    }
  } finally {
    pin.release()
  }
}

/** Deferred, best-effort, single-flight cleanup per home. Launches never await this promise. */
export function sweepSkillViews(managedRoot: string, home: string, current: string): Promise<void> {
  const key = resolve(home)
  const running = sweeps.get(key)
  if (running) return running
  const pending = setImmediate()
    .then(() => sweep(managedRoot, key, current))
    .catch(() => {
      // Even a failed initial pin or listing is cleanup failure, not launch failure. A later
      // launch can retry once this flight has settled.
    })
    .finally(() => {
      sweeps.delete(key)
    })
  sweeps.set(key, pending)
  return pending
}
