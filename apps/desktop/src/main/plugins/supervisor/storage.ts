import { randomUUID } from 'node:crypto'
import { isMainThread } from 'node:worker_threads'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime/provider-home'
import { OwnerRecord, PluginSupervisorError, refuse, StopRecord } from './protocol'
import { isSocketFile, localEndpoint } from '../local-endpoint'
import {
  isWithinOrSame,
  openDirectoryNotThroughALink,
  realPath,
  syncDirectory,
} from '../private-files'

const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
function privateEntry(stat: BigIntStats, directory: boolean): void {
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)
  )
    refuse()
}
/** Explicit root only. Never searches a live root or follows a link to one. */
export class SupervisorStorage {
  private pins: { path: string; stat: BigIntStats; fd: number }[] = []
  readonly folder: string
  readonly socket: string
  readonly lock: string
  readonly record: string
  readonly stop: string
  readonly identity: string = ''
  readonly rootIdentity: string = ''
  constructor(
    readonly root: string,
    workspaceRoots: readonly string[],
    create: boolean,
  ) {
    this.folder = join(root, 'supervisor')
    this.socket = join(this.folder, 'owner.sock')
    this.lock = join(this.folder, 'owner-lock.sqlite')
    this.record = join(this.folder, 'owner.json')
    this.stop = join(this.folder, 'owner-stop.json')
    try {
      if (!isMainThread) refuse('unsupported')
      if (
        !isAbsolute(root) ||
        resolve(root) !== root ||
        realPath(dirname(root)) !== dirname(root) ||
        (isSocketFile() && Buffer.byteLength(this.socket) > 100)
      )
        refuse()
      let intended = join(realPath(dirname(root)), basename(root))
      let existingRoot = false
      try {
        privateEntry(lstatSync(root, { bigint: true }), true)
        intended = realPath(root)
        existingRoot = true
      } catch (error) {
        if (!missing(error)) throw error
      }
      for (const workspace of workspaceRoots) {
        const canonical = realPath(workspace),
          stat = lstatSync(canonical, { bigint: true })
        if (!stat.isDirectory()) refuse()
        if (isWithinOrSame(canonical, intended)) refuse()
        for (let path = existingRoot ? root : dirname(root); ;) {
          if (same(lstatSync(path, { bigint: true }), stat)) refuse()
          const parent = dirname(path)
          if (parent === path) break
          path = parent
        }
      }
      this.pin(dirname(root))
      for (const path of [root, this.folder]) {
        try {
          lstatSync(path)
        } catch (error) {
          if (!missing(error) || !create) throw error
          this.check()
          try {
            mkdirSync(path, { mode: 0o700 })
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
          }
          syncDirectory(this.pins.at(-1)!.fd)
        }
        this.pin(path)
      }

      const stat = this.pins.at(-1)!.stat
      this.identity = `${stat.dev}:${stat.ino}`
      const rootStat = this.pins.find((pin) => pin.path === root)!.stat
      this.rootIdentity = `${rootStat.dev}:${rootStat.ino}`
    } catch (error) {
      this.close()
      if (error instanceof PluginSupervisorError) throw error
      refuse()
    }
  }
  private pin(path: string): void {
    const stat = lstatSync(path, { bigint: true })
    privateEntry(stat, true)
    const fd = openDirectoryNotThroughALink(path)
    if (!same(stat, fstatSync(fd, { bigint: true }))) {
      closeSync(fd)
      refuse()
    }
    this.pins.push({ path, stat, fd })
  }
  check(): void {
    for (const pin of this.pins) {
      const now = lstatSync(pin.path, { bigint: true })
      privateEntry(now, true)
      if (!same(now, pin.stat) || !same(fstatSync(pin.fd, { bigint: true }), pin.stat)) refuse()
    }
  }
  read(): OwnerRecord | null {
    this.check()
    let before: BigIntStats
    try {
      before = lstatSync(this.record, { bigint: true })
    } catch (error) {
      if (missing(error)) return null
      refuse()
    }
    privateEntry(before, false)
    const fd = openNotThroughALink(this.record, constants.O_RDONLY)
    try {
      const held = fstatSync(fd, { bigint: true })
      if (!same(before, held) || held.size > 4096n) refuse()
      const result = OwnerRecord.parse(JSON.parse(readFileSync(fd, 'utf8')))
      this.check()
      return result
    } catch {
      refuse()
    } finally {
      closeSync(fd)
    }
  }
  /** Advice only; this receipt never releases the fence or authorizes another owner. */
  readStop(): ReturnType<typeof StopRecord.parse> | null {
    this.check()
    try {
      const before = lstatSync(this.stop, { bigint: true })
      privateEntry(before, false)
      const fd = openNotThroughALink(this.stop, constants.O_RDONLY | constants.O_NONBLOCK)
      try {
        const held = fstatSync(fd, { bigint: true })
        if (!same(before, held) || held.size > 4096n) refuse()
        const result = StopRecord.parse(JSON.parse(readFileSync(fd, 'utf8')))
        const after = fstatSync(fd, { bigint: true })
        if (!same(held, after) || held.size !== after.size) refuse()
        this.check()
        return result
      } finally {
        closeSync(fd)
      }
    } catch (error) {
      if (missing(error)) return null
      refuse()
    }
  }
  write(value: OwnerRecord): void {
    this.publish(this.record, JSON.stringify(OwnerRecord.parse(value)))
  }
  writeStop(value: StopRecord): void {
    this.publish(this.stop, JSON.stringify(StopRecord.parse(value)))
  }
  private publish(path: string, text: string): void {
    this.check()
    const temporary = join(this.folder, `.owner-${randomUUID()}`)
    const fd = createFreshFile(temporary, 0o600)
    try {
      writeFileSync(fd, text)
      fsyncSync(fd)
      this.check()
      renameSync(temporary, path)
      syncDirectory(this.pins.at(-1)!.fd)
    } finally {
      closeSync(fd)
      try {
        unlinkSync(temporary)
      } catch {
        /* only this unpublished temporary file */
      }
    }
  }
  /** Where the owner with this record listens ({@link localEndpoint}). */
  endpoint(record: OwnerRecord): string {
    return localEndpoint(this.socket, 'owner', record.epoch)
  }
  /** Only a fenced, clean successor may remove its own stale socket. A pipe ends with its server. */
  clearSocket(): void {
    this.check()
    if (!isSocketFile()) return
    try {
      const stat = lstatSync(this.socket, { bigint: true })
      if (!stat.isSocket()) refuse()
      unlinkSync(this.socket)
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  close(): void {
    for (const pin of this.pins.splice(0).reverse()) closeSync(pin.fd)
  }
}
